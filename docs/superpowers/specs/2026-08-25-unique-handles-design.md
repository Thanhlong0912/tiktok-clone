# Unique handles

Status: proposed, 2026-08-25.

## The problem

`profiles.name` is doing two jobs it cannot both do. It is the display name —
rendered at 30px on the profile header — and it is also the identity every
`@mention` resolves against, rendered as `@{name}` in nine places. It is
declared `text not null` with no length, charset, or uniqueness constraint, and
the only validation anywhere in the app is "not empty".

The consequences are already visible in production:

- The profile header renders the same value twice, so an account reads
  `Rowan Bui` over `@Rowan Bui`. A handle with a space in it is not a handle.
- Three mention keys collide across 28 accounts — `emersonduong`, `namduong`
  and `quandang`, two rows each. `0010_mention_notifications.sql` deliberately
  notifies **nobody** for an ambiguous key, so six accounts cannot be mentioned
  at all. That was the right call for 0010 and it is not a fix.
- `EditProfileOverlay` already calls the field "Username" and errors with "A
  Username is required", so the product has been describing `name` as a handle
  while the schema treated it as free text.

## Decisions already taken

Three questions were settled before this document:

1. **Two fields, not one.** `handle` is added; `name` stays the display name.
   The profile header's second line finally gets real data instead of a copy of
   the first.
2. **Handles are editable, and released handles are reserved forever.** A
   `handle_reservations` table retains every handle an account has held so
   nobody else can claim it.
3. **One coordinated change**, not a phased rollout. Phasing was rejected for a
   specific reason: a DB-only phase is safe only while `handle` and
   `mention_key(name)` agree, which stops being true the moment anyone edits
   their display name. That is the same silent client/server divergence
   `mention_key` exists to prevent.

## Why reservations matter

Mentions are stored as literal text inside `posts.text` and `comments.text`.
Nothing rewrites a caption when an account changes its handle. So if `@rowanbui`
is released and someone else claims it, every historical caption mentioning
`@rowanbui` begins linking to — and, through the 0010 triggers, notifying — a
different person. That is impersonation by inheritance, and a unique index alone
does not prevent it. `handle_reservations` is what makes a released handle
unclaimable rather than merely currently-taken.

## Data model

```sql
alter table public.profiles
    add column if not exists handle text;

-- Enforced case-insensitively by storing lowercase and constraining the charset.
alter table public.profiles
    add constraint profiles_handle_format
    check (handle ~ '^[a-z0-9._]{2,24}$');

create unique index if not exists profiles_handle_key on public.profiles (handle);
```

`handle` is `NOT NULL` only after the backfill lands, added as a separate
statement so the backfill is not racing a constraint.

```sql
create table if not exists public.handle_reservations (
    handle     text primary key,
    user_id    uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    released_at timestamptz
);
```

Every handle ever assigned gets a row, including the current one — `released_at`
null means "in use". A claim is legal only when no reservation row exists, which
makes the check a single primary-key probe.

### Charset

`^[a-z0-9._]{2,24}$` — lowercase only, so uniqueness needs no `lower()`
expression index and no citext dependency; the constraint makes the column its
own canonical form. Dots and underscores are allowed because they are what
people expect from a handle; nothing else is, which keeps a handle unambiguous
in a caption where `@` and `#` and whitespace terminate the token.

All 28 existing names normalise into `[a-z]+` already, so the charset costs
nothing on backfill.

## Backfill

Derivation is `mention_key(name)` with any character outside the charset
removed, then truncated to 24 — call it `handle_from_name(text)`, a function
this migration adds and both the backfill and `handle_new_user` share.

The `mention_key` half is deliberate rather than convenient: every mention
already written into a caption was written against `mention_key(name)`, so
deriving handles the same way means **existing mentions keep resolving**.
Choosing an unrelated derivation would silently orphan them.

The folding half is not optional, and it is the one place the two normalisers
must not be confused. `mention_key` preserves punctuation and accents on
purpose — `@O'Brien` and `@OBrien` are two different people to a *token*
resolver. But a handle is a stored value bound by `^[a-z0-9._]{2,24}$`, so
`O'Brien` must become `obrien` or the insert violates its own constraint.

**Revised during implementation.** This section originally specified a plain
strip of illegal characters, and called transliteration explicitly out of
scope. Measuring it against real inputs showed that to be wrong for this app's
users: a strip deletes accented letters outright, turning `Nguyễn Văn A` into
`nguynvna` and `Thành` into `thnh`. The derivation is therefore NFD
normalisation *then* strip, which decomposes an accented letter into its base
plus combining marks and drops only the marks — giving `nguyenvana` and
`thanh`.

One character needs handling by name: `đ` (U+0111, d with stroke) has no
canonical decomposition, because the stroke is part of the glyph rather than a
combining mark. NFD leaves it and the strip then deletes it, so `Đặng Quân`
becomes `angquan` — losing the first letter of the name. An explicit
`replace(…, 'đ', 'd')` before normalising gives `dangquan`.

All 28 existing names are plain ASCII letters and spaces, so every step after
`mention_key` is a no-op for them. This was verified rather than assumed:
zero live rows derive a different handle under folding than under
`mention_key` alone, so continuity with mentions already written into captions
is total.

The three colliding pairs get a numeric suffix on the later row by
`created_at`, so the account that had the name first keeps the bare handle:
`emersonduong` / `emersonduong2`, and likewise for `namduong` and `quandang`.

Backfill runs before `NOT NULL` is applied, and inserts one
`handle_reservations` row per profile.

The six colliding accounts are the only ones whose mentions change behaviour,
and they change from "notifies nobody" to "notifies exactly one person", which
is strictly better than today.

## Assignment at signup

`handle_new_user` calls the same `handle_from_name` and loops on collision. The
Register form is not changed — it already collects a display name and passes it
through `raw_user_meta_data`, and adding a handle field would mean an
availability check inside a signup flow that cannot easily recover from failure.
An auto-assigned handle that the user can change afterwards is TikTok's own
behaviour.

Derivation must be total: a display name of `""`, or one that normalises to
fewer than two legal characters, falls back to `user` plus a suffix rather than
failing the signup. A trigger that can reject an account creation is a trigger
that can lock somebody out of the product.

## Rename

An availability RPC, `SECURITY DEFINER`, `authenticated` only:

```sql
public.handle_available(p_handle text) returns boolean
```

True when the handle is well-formed and no `handle_reservations` row exists, or
the only row belongs to the caller. It is advisory — the unique index and the
reservation primary key are the actual enforcement, because anything else races.

Renaming is `public.set_handle(p_handle text)`, which validates, inserts the
reservation, stamps `released_at` on the previous one, and updates the profile,
in one transaction. The client must handle a lost race gracefully: the RPC
raising on a taken handle is the expected path, not an exception.

`set_handle` derives the actor from `(select auth.uid())` and never from an
argument, per the rule 0003 established for every writer in this schema.

## Mention resolution

`0010`'s triggers currently join `public.profiles pr on mention_key(pr.name) =
t.key` with a `count(*) = 1` ambiguity guard. Both trigger functions change to
`join public.profiles pr on pr.handle = t.key`, and **the ambiguity guard is
deleted** — a unique index makes it dead code, and leaving a guard that can no
longer fire is worse than removing it.

`mention_key` stays. It is still the right normaliser for the *token* — it
lowercases and strips stray `@` — and its parity fixture in
`app/utils/mentions.test.ts` still pins client and server together. What changes
is only what the normalised token is compared against.

`profiles_mention_key_idx` becomes unused and is dropped in the same file.

## RPC surface

This is the bulk of the work, and it splits cleanly by whether a change alters a
function's signature.

> **Revised during implementation.** The seven body-only changes were dropped
> from scope. `get_feed` and `get_user_posts` carry profile columns through
> ranking CTEs (`page`, `source`), so `pr` is not in scope at their outer
> select and threading the handle means editing the ranking logic itself — the
> riskiest SQL in the schema, for a column the feed card can get another way.
> Feed cards now resolve handles through one cached client-side lookup on
> `profiles`, which is already publicly readable. The ten signature changes
> below are unaffected and proceed as written.

**Body-only — `CREATE OR REPLACE`, grants preserved (7), NOT DONE, see above:**
`get_feed`, `get_following_feed`, `get_post`, `get_posts_by_hashtag`,
`get_user_posts`, `search_videos` all return `SETOF feed_post`, so one
`alter type public.feed_post add attribute profile_handle text` serves all six
and each body gains one column. This was verified against production in an
aborted transaction: `ALTER TYPE ... ADD ATTRIBUTE` succeeds with all six
dependent functions in place. `search_top` returns `jsonb` and is likewise
body-only.

**Signature change — `DROP` then `CREATE`, grants MUST be restated (10):**
`get_blocked_accounts`, `get_comment_replies`, `get_followers`,
`get_following_accounts`, `get_muted_accounts`, `get_notifications`,
`get_post_comments`, `get_profile`, `get_trending_creators`, `search_users`.

> Every one of these ten must have its `revoke`/`grant` restated immediately
> after the `create`. This is not a style preference. `0006_hardening.sql`
> dropped and recreated `get_notifications` without restating its grant, and the
> replacement silently became callable by `anon`; it took until `0009` to notice.
> A `DROP` takes the ACL with it, every time.

`search_users` additionally matches on handle, not just name — a user searching
`@rowanbui` should find that account.

## Client changes

- `profiles` type and every consumer gain `handle`.
- The nine `@{name}` sites become `@{handle}`. The profile header keeps `name`
  on the first line and finally renders a real handle on the second.
- `EditProfileOverlay` gains a handle field with a debounced `handle_available`
  check, and its "Username" copy moves to that field — the display name field
  stops calling itself a username.
- `CaptionComposer` inserts `@handle` on pick and suggests against handle.
- `resolveMentionUserId` collapses to a single `profiles.select('user_id').eq('handle', key)`.
  The localStorage mention registry, the feed-cache scan, and the negative TTL
  all disappear: they exist only because a name lookup was unreliable, and a
  unique indexed handle is not.
- `mentionKey` and its parity fixture stay exactly as they are.

## Testing

- Unit: handle derivation and suffixing as pure functions, alongside the
  existing `mentionKey` fixture.
- SQL, in aborted transactions against production, following this session's
  established pattern: backfill produces 28 unique handles with the three
  suffixes on the expected rows; a second run is idempotent; `set_handle`
  reserves the old handle and rejects a reclaim by another account;
  `handle_available` agrees with what `set_handle` actually permits; the mention
  triggers resolve by handle including for the six formerly-ambiguous accounts;
  `handle_new_user` assigns a handle for a fresh signup and for a display name
  that normalises to nothing.
- Grants: assert all ten dropped-and-recreated functions end with the same ACL
  they started with. This is a direct regression test for the 0006 failure.
- Browser: profile header, edit-profile availability states, composer insertion.

## Accepted consequences

- **Six accounts get a handle that is not simply their name.** `emersonduong2`
  is not pretty. The alternative was leaving them unmentionable.
- **Old captions keep their literal text.** A rename does not rewrite history,
  so a caption can mention `@oldhandle` and render it as plain text once the
  reservation is released-but-unclaimable. That is the intended trade: a dead
  mention is much better than one pointing at the wrong person.
- **Display names stay non-unique.** Two people can both be "Nam Duong"; only
  their handles differ. This is the point of splitting the fields.
- **The migration is large** — roughly 20KB, dominated by the ten function
  bodies that must be restated in full to change their signature.

## Out of scope

- `/@handle` profile routes. Profile URLs stay `/profile/[user_id]`; making
  handles routable is a separate change with its own redirect and
  collision-with-existing-routes questions.
- Reserved-word blocklist (`admin`, `support`, …). Worth doing, not needed to
  fix ambiguity.
- Rewriting historical captions on rename.
- Rate limiting handle changes.
