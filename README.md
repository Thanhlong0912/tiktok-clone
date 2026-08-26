This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Architecture

There is no server tier: every page is a client component and all data access
goes through the browser supabase-js client. The ranking, aggregation and
moderation logic that a server would normally own lives in `SECURITY DEFINER`
Postgres functions instead (`supabase/migrations/0003_feed_rpcs.sql`), called
with `supabase.rpc()`.

The feed is one call, with one exception. `get_feed` returns a page of ranked
posts together with their authors, their counters and the viewer's own
like/save/repost/follow state, so a card renders without fetching anything of
its own — except the author's `handle`. `get_feed` and `get_user_posts` build
their rows through ranking CTEs that never bring `profiles` into scope for
that column, and threading a handle through would mean editing ranking logic
for a column those queries otherwise have no need of. So a post's author
handle resolves through one extra batched, cached lookup instead
(`app/utils/handleLookup.ts`), coalesced across every card mounted in the same
render pass rather than fetched per card.

Two rules hold for anything added to that file:

1. Definer functions bypass RLS, so the `deleted_at is null` and block/mute
   predicates inside them are the only thing standing in for it.
2. Writers derive the actor from `(select auth.uid())`, never from an argument.

Comments follow the same shape as of `0007_comment_threads_and_social_lists.sql`.
`get_post_comments` returns a page of top-level comments with their authors,
their counters, their reply count and the viewer's own like state;
`get_comment_replies` returns the identical columns for one thread, so a single
component renders both levels. Threads are **two levels deep and never three** —
a trigger rejects a reply to a reply, which is what keeps the cascade one level
deep, gives `reply_count` exactly one owner, and keeps every read non-recursive.

## Supabase setup

This app uses Supabase for Postgres, Auth and Storage. Before running it:

1. **Run the schema.** Paste each file in `supabase/migrations/` into the
   Supabase SQL editor in order and run it. All of them are idempotent.

   Two things about the SQL editor will silently apply a migration to the
   wrong place, or to nothing at all. Both report success:

   - **Check the branch selector first.** If the project has database
     branches, the editor writes to the *selected branch*, not to production —
     and a preview branch is a copy, so it has the same tables and the same
     row counts. The project ref in the browser URL stays the same either way,
     so it cannot be used to tell them apart. Confirm the selector reads
     production before running anything.
   - **Select all before running.** The editor executes only the highlighted
     text when a selection exists, so a stray selection left over from pasting
     runs a fragment and reports success. Click into the editor, press
     Cmd/Ctrl+A, then Run.

   To verify a migration actually landed where you meant, query the catalog
   rather than trusting the editor — `information_schema` does not care about
   PostgREST's cache, which lags behind DDL and will misreport a fresh column
   as missing:

   ```sql
   select current_database(),
          inet_server_addr() as host,
          (select count(*) from public.comments) as comments,
          exists (select 1 from information_schema.columns
                   where table_name = 'comments' and column_name = 'parent_id')
            as has_0007;
   ```

   If the API still cannot see new objects a minute later, run
   `notify pgrst, 'reload schema';` on its own, and failing that restart the
   project from Settings → General.

   The editor is avoidable entirely. `psql` against the project's own host
   takes no branch context and fails loudly instead of silently:

   ```bash
   psql "postgresql://postgres:PASSWORD@db.<project-ref>.supabase.co:5432/postgres" \
        -v ON_ERROR_STOP=1 -f supabase/migrations/0007_comment_threads_and_social_lists.sql
   ```
   - `0001_init.sql` — the seven base tables, RLS, the `handle_new_user`
     trigger, and the public `media` storage bucket.
   - `0002_feed_and_signals.sql` — denormalized counters maintained by
     triggers, watch/view signals, hashtag tables, notifications, moderation
     tables, affinity tables, and the missing `posts.user_id → profiles.user_id`
     foreign key that PostgREST embeds need.
   - `0003_feed_rpcs.sql` — the feed, discovery, signal-recording and reporting
     functions, plus the `pg_cron` jobs that refresh ranking scores.
   - `0004_rls_initplan_and_fk_indexes.sql` — performance follow-ups.
   - `0005_post_captions.sql` — creator-supplied subtitle tracks.
   - `0006_hardening.sql` — **required.** Scopes the storage write policies to
     the object's owner (without it, any signed-in user can delete anyone's
     media), restricts UPDATE to the columns users may actually edit (without
     it, anyone can write their own engagement counters, which feed ranking),
     and adds the notification type filter the Activity tabs use.
   - `0007_comment_threads_and_social_lists.sql` — **required.** Comment
     replies (one level, enforced by trigger) and comment likes, with their
     counters, the same column-grant hardening 0006 applied to posts, and a
     reply branch in the notification trigger so a reply reaches the person
     replied to rather than the post author. Then the account lists PostgREST
     cannot serve on its own, because `follows` / `blocks` / `mutes` all
     reference `auth.users` rather than `profiles`: `get_followers`,
     `get_following_accounts`, `get_blocked_accounts`, `get_muted_accounts`.

     This one is not optional and not deferrable. The comment section calls
     `get_post_comments` on every post; until the file is run, every thread in
     the app renders its error state.
   - `0008_posts_column_grants.sql` — **required.** Closes the INSERT half of
     what 0006 closed for UPDATE: without it a client can publish a post that
     arrives with its engagement counters already set, which is the same feed
     manipulation one statement earlier. It restates 0006's UPDATE grant as
     well, so it is correct on a database where 0006 never ran.
   - `0009_profiles_insert_and_notifications_grant.sql` — **required.** The two
     grants 0006 and 0008 left behind. Revokes INSERT on `profiles`, which was
     the same counter hole one table over (a new account could hand itself any
     `follower_count`), with no column grant to replace it because nothing in
     the app inserts a profile — `handle_new_user` does. Then restores
     `get_notifications` to authenticated-only: 0006 had to DROP and recreate
     it to add the type filter, and a DROP takes the function's grants with it,
     so the replacement was left callable by `anon`.
   - `0010_mention_notifications.sql` — makes the `'mention'` notification type
     real. It has been in the CHECK since 0002 and in the Activity renderer the
     whole time, but nothing ever inserted one, so an @mention linkified to a
     profile and notified nobody. Adds `public.mention_key` — which must stay
     in step with `mentionKey()` in `app/utils/mentionKey.ts`, pinned by the
     shared fixture in `app/utils/mentions.test.ts` — and a trigger on each of
     `posts` and `comments`. Mentions whose key matches more than one account
     notify nobody, because `profiles.name` is not unique. Not backfilled:
     existing captions stay silent rather than firing hundreds of
     notifications about old posts.
   - `0011_unique_handles.sql` — **required.** Splits the identity `name` was
     doing two jobs of into two fields. `name` stays the display name; a new
     `profiles.handle` — unique, lowercase, `[a-z0-9._]{2,24}` — becomes the
     identity. Backfills every existing account and adds `handle_reservations`,
     a history of every handle an account has ever held. That table is not
     optional bookkeeping: mentions are literal text baked into `posts.text`
     and `comments.text`, so a released handle can never be reclaimed — handing
     it to someone new would re-point every old mention at a different person.
     Handles are assigned automatically at signup (`handle_new_user`) and
     changed from Edit profile through `handle_available` / `set_handle`, the
     advisory-check-plus-enforced-write pattern used everywhere in this schema.
     Mentions now resolve by `handle` instead of `mention_key(name)`, which
     removes 0010's ambiguity guard and makes the previously-unmentionable
     accounts — the ones whose display names collided — mentionable. Without
     this file, every RPC that returns a `handle` column fails outright.
     `app/utils/handle.ts` mirrors the SQL CHECK's pattern and is pinned by the
     fixture in `app/utils/handle.test.ts`, the same discipline `mentionKey()` /
     `mention_key` and `normalizeTag` / `normalize_tag` already use elsewhere
     in this codebase.
2. **Upload the default avatar.** In Storage → `media`, upload an image named exactly `placeholder-avatar.png`. New profiles point at it until the user picks their own picture. The name must match `NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID` in `.env` and the default in `handle_new_user()` — extension included.
3. **Disable email confirmation.** Auth → Providers → Email → turn off "Confirm email", so registering signs the user in straight away. If you leave it on, registration will ask the user to confirm their address first.
4. **Fill in `.env`.** Copy `.env.example` to `.env` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Project settings → API.

## Getting Started

First, run the development server:

```bash
npm run dev
```

### Seed data (development only)

An empty database cannot exercise ranking, trending or pagination. The seeder
creates ~25 accounts and ~250 posts with synthetic watch, like and follow
history, reusing media keys already in your bucket so the posts actually play:

```bash
npm run seed
```

It needs `SUPABASE_SERVICE_ROLE_KEY` in `.env` and at least one existing video
post to borrow a media key from. Every account it creates lives on
`@seed.local.test`, which is how it removes exactly what it created:

```bash
npm run seed -- --clean
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
