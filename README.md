This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Architecture

There is no server tier: every page is a client component and all data access
goes through the browser supabase-js client. The ranking, aggregation and
moderation logic that a server would normally own lives in `SECURITY DEFINER`
Postgres functions instead (`supabase/migrations/0003_feed_rpcs.sql`), called
with `supabase.rpc()`.

The feed is one call. `get_feed` returns a page of ranked posts together with
their authors, their counters and the viewer's own like/save/repost/follow
state, so a card renders without fetching anything of its own.

Two rules hold for anything added to that file:

1. Definer functions bypass RLS, so the `deleted_at is null` and block/mute
   predicates inside them are the only thing standing in for it.
2. Writers derive the actor from `(select auth.uid())`, never from an argument.

## Supabase setup

This app uses Supabase for Postgres, Auth and Storage. Before running it:

1. **Run the schema.** Paste each file in `supabase/migrations/` into the
   Supabase SQL editor in order and run it. All four are idempotent.
   - `0001_init.sql` — the seven base tables, RLS, the `handle_new_user`
     trigger, and the public `media` storage bucket.
   - `0002_feed_and_signals.sql` — denormalized counters maintained by
     triggers, watch/view signals, hashtag tables, notifications, moderation
     tables, affinity tables, and the missing `posts.user_id → profiles.user_id`
     foreign key that PostgREST embeds need.
   - `0003_feed_rpcs.sql` — the feed, discovery, signal-recording and reporting
     functions, plus the `pg_cron` jobs that refresh ranking scores.
   - `0004_rls_initplan_and_fk_indexes.sql` — performance follow-ups.
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
