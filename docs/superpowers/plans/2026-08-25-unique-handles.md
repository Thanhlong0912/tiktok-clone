# Unique Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `profiles.name` into a display name plus a unique, editable `handle`, so `@mentions` resolve to exactly one account.

**Architecture:** One migration (`0011`) adds the column, a reservations table, a shared derivation function, and two RPCs; repoints the `0010` mention triggers at `handle`; and threads `handle` through the 17 RPCs that return a profile name. The client then renders display-name-over-handle and gains a handle editor. The migration is deliberately **backward compatible** — every change is additive from the old client's point of view — which is what lets it land on production before the client PR merges.

**Tech Stack:** Postgres 17.6 (Supabase, project `wizqdldpecssptdsnnot`), Next.js 13 App Router, supabase-js, vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-unique-handles-design.md`

## Global Constraints

- Handle charset, verbatim: `^[a-z0-9._]{2,24}$`. Lowercase only — the column is its own canonical form, so uniqueness needs no `lower()` index.
- Every writer derives the actor from `(select auth.uid())`, never from an argument (rule from 0003).
- Definer functions bypass RLS, so `deleted_at is null` and block/mute predicates inside them are the only thing standing in for it (rule from 0003).
- **Any function that is DROPped and recreated MUST have its `revoke`/`grant` restated in the same file.** `DROP` takes the ACL with it. 0006 did not do this for `get_notifications` and it was silently `anon`-callable until 0009.
- Migrations are applied via the Supabase MCP `apply_migration`, never the SQL editor. Transcribe, `diff` against the file, and confirm matching `shasum -a 256` before sending. Verify against the catalog afterwards, not the tool's success flag.
- Every behavioural check against production runs inside a transaction that ends in `raise exception`, so nothing commits.

## Sequencing note (read before Task 9)

`0011` is additive: a new column, new attributes on `feed_post`, new columns on ten `RETURNS TABLE` signatures, two new RPCs, and a trigger that resolves by a different column. PostgREST returns extra keys and the current client ignores them. **Nothing in the deployed client breaks when 0011 lands.** So the order is: apply 0011 to production, confirm the live app is unaffected, then merge the client PR. Do not invert this — the client cannot render `handle` before the column exists.

---

### Task 1: Client-side handle validation

**Files:**
- Create: `app/utils/handle.ts`
- Create: `app/utils/handle.test.ts`

**Interfaces:**
- Produces: `HANDLE_PATTERN: RegExp`, `MIN_HANDLE_LENGTH: 2`, `MAX_HANDLE_LENGTH: 24`, `isValidHandle(value: string): boolean`, `handleError(value: string): string | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { handleError, isValidHandle, MAX_HANDLE_LENGTH } from './handle'

/**
 * Shared fixture: the SAME inputs are verified against the
 * profiles_handle_format CHECK in Postgres. If the charset changes on either
 * side, run this against the database too:
 *
 *   select v, v ~ '^[a-z0-9._]{2,24}$' from (values ...) t(v);
 */
export const HANDLE_VALIDITY_PARITY: Array<[string, boolean]> = [
  ['rowanbui', true],
  ['a.b_c', true],
  ['user.1', true],
  ['ab', true],
  ['x'.repeat(MAX_HANDLE_LENGTH), true],
  ['x'.repeat(MAX_HANDLE_LENGTH + 1), false],
  ['a', false],
  ['', false],
  ['Rowan', false],
  ['rowan bui', false],
  ['rowan-bui', false],
  ["o'brien", false],
  ['thành', false],
  ['@rowan', false],
]

describe('isValidHandle', () => {
  it.each(HANDLE_VALIDITY_PARITY)('%j -> %j (verified against SQL)', (value, expected) => {
    expect(isValidHandle(value)).toBe(expected)
  })
})

describe('handleError', () => {
  it('is null for a valid handle', () => {
    expect(handleError('rowanbui')).toBeNull()
  })

  it('names the specific problem rather than restating the pattern', () => {
    expect(handleError('Rowan')).toMatch(/lowercase/i)
    expect(handleError('a')).toMatch(/2/)
    expect(handleError('x'.repeat(25))).toMatch(/24/)
    expect(handleError('rowan bui')).toMatch(/letters, numbers/i)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run app/utils/handle.test.ts`
Expected: FAIL — cannot resolve `./handle`.

- [ ] **Step 3: Implement**

```ts
/**
 * Handle rules, mirrored by the profiles_handle_format CHECK in
 * supabase/migrations/0011_unique_handles.sql. app/utils/handle.test.ts pins
 * the shared fixture, the same way postTags.test.ts does for normalize_tag.
 *
 * This is NOT mentionKey. mentionKey normalises a TOKEN found in a caption and
 * deliberately preserves punctuation, because @O'Brien and @OBrien are two
 * different people to a resolver. This validates a STORED value, which has a
 * much narrower charset.
 */

export const MIN_HANDLE_LENGTH = 2
export const MAX_HANDLE_LENGTH = 24
export const HANDLE_PATTERN = /^[a-z0-9._]{2,24}$/

export function isValidHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value)
}

/** A specific message, or null when the handle is fine. */
export function handleError(value: string): string | null {
  if (!value) return 'A handle is required'
  if (value.length < MIN_HANDLE_LENGTH) return `Handles are at least ${MIN_HANDLE_LENGTH} characters`
  if (value.length > MAX_HANDLE_LENGTH) return `Handles are at most ${MAX_HANDLE_LENGTH} characters`
  if (/[A-Z]/.test(value)) return 'Handles are lowercase'
  if (!HANDLE_PATTERN.test(value)) return 'Handles use letters, numbers, dots and underscores only'
  return null
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/utils/handle.test.ts` — expect PASS.
Then `npm test` — expect all files passing.

- [ ] **Step 5: Verify the fixture against Postgres**

Run the same values through the CHECK expression via MCP `execute_sql`:

```sql
select v, (v ~ '^[a-z0-9._]{2,24}$') as sql_says
from (values ('rowanbui'),('a.b_c'),('user.1'),('ab'),('a'),(''),('Rowan'),
             ('rowan bui'),('rowan-bui'),('o''brien'),('thành'),('@rowan')) t(v);
```

Expected: agrees with `HANDLE_VALIDITY_PARITY` on every row. If any row disagrees, the charset is wrong on one side — fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add app/utils/handle.ts app/utils/handle.test.ts
git commit -m "feat(handles): handle charset rules, pinned to the SQL CHECK"
```

---

### Task 2: Migration 0011 — schema and derivation

**Files:**
- Create: `supabase/migrations/0011_unique_handles.sql`

**Interfaces:**
- Produces: `profiles.handle text`, `profiles_handle_key` unique index, `public.handle_reservations`, `public.handle_from_name(text) returns text`

- [ ] **Step 1: Write the section**

```sql
-- Unique handles. Run after 0010. Idempotent -- safe to re-run.
--
-- profiles.name has been doing two jobs: the display name on the profile
-- header, and the identity every @mention resolves against. It is text not
-- null with no length, charset or uniqueness constraint. 0010 had to notify
-- NOBODY for a mention key matching more than one account, which is why six
-- accounts cannot currently be mentioned at all.

set lock_timeout = '5s';

-- The charset is lowercase-only so the column is its own canonical form: no
-- lower() expression index, no citext, and a unique index that means what it
-- says. Dots and underscores are allowed because they are what people expect
-- of a handle; nothing else is, which keeps a handle unambiguous inside a
-- caption where @, # and whitespace terminate the token.
alter table public.profiles
    add column if not exists handle text;

do $$
begin
    alter table public.profiles
        add constraint profiles_handle_format
        check (handle ~ '^[a-z0-9._]{2,24}$');
exception when duplicate_object then null;
end;
$$;

create unique index if not exists profiles_handle_key on public.profiles (handle);

-- Every handle an account has ever held. released_at null means "in use".
--
-- This table is the difference between "currently taken" and "can never be
-- taken". Mentions are literal text inside posts.text and comments.text and
-- nothing rewrites a caption on rename, so a reclaimed handle would re-point
-- every historical mention of it at a different person. A unique index alone
-- does not prevent that; this does.
create table if not exists public.handle_reservations (
    handle      text primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    created_at  timestamptz not null default now(),
    released_at timestamptz
);

create index if not exists handle_reservations_user_idx
    on public.handle_reservations (user_id);

alter table public.handle_reservations enable row level security;

-- Readable by nobody through the API: availability is answered by the RPC in
-- section 4, which is SECURITY DEFINER. Exposing the table would let anyone
-- enumerate every handle every account has ever used.
revoke all on public.handle_reservations from anon, authenticated;

-- Derivation, shared by the backfill and by handle_new_user.
--
-- mention_key first, deliberately: every mention already written into a
-- caption was written against mention_key(name), so deriving handles the same
-- way keeps existing mentions resolving. Then strip anything outside the
-- charset, because mention_key preserves punctuation and accents on purpose
-- and a stored handle cannot. For all 28 rows present when this was written
-- the two steps coincide exactly.
--
-- Total by construction: a name that normalises to nothing yields 'user',
-- which the caller then makes unique. A trigger that can reject an account
-- creation is a trigger that can lock somebody out of the product.
create or replace function public.handle_from_name(p_name text)
returns text
language sql
immutable
parallel safe
as $$
    select case
        when length(base) >= 2 then left(base, 24)
        else 'user'
    end
    from (
        select pg_catalog.regexp_replace(
                   public.mention_key(coalesce(p_name, '')),
                   '[^a-z0-9._]', '', 'g') as base
    ) d;
$$;
```

- [ ] **Step 2: Dry-run the section against production, aborting**

Send the section above followed by a probe, in ONE `execute_sql` call so the whole thing is one transaction:

```sql
do $t$
declare v_bad text;
begin
  select string_agg(n || ' -> ' || public.handle_from_name(n), E'\n')
    into v_bad
  from (values ('Rowan Bui'),('O''Brien'),('Thành'),(''),('  '),('@@'),
               ('A'),(repeat('x', 40))) v(n);
  raise exception E'handle_from_name:\n%', v_bad;
end $t$;
```

Expected, and check each one: `Rowan Bui -> rowanbui`, `O'Brien -> obrien`, `Thành -> thnh`, `'' -> user`, `'  ' -> user`, `@@ -> user`, `A -> user`, and the 40-x name truncated to 24 characters.

> `Thành -> thnh` is correct-but-ugly: stripping is not transliteration. Accept it — the account can rename — but confirm it does not produce something under 2 characters for a short accented name. If a real name ever yields fewer than 2 legal characters the fallback catches it.

- [ ] **Step 3: Commit the migration file (not yet applied)**

```bash
git add supabase/migrations/0011_unique_handles.sql
git commit -m "feat(db): 0011 schema for unique handles"
```

---

### Task 3: Migration 0011 — backfill

**Files:**
- Modify: `supabase/migrations/0011_unique_handles.sql` (append)

**Interfaces:**
- Consumes: `handle_from_name` from Task 2
- Produces: every `profiles` row has a unique `handle`; one `handle_reservations` row each

- [ ] **Step 1: Append the section**

```sql
-- ---------------------------------------------------------------------------
-- Backfill.
--
-- Ordered by created_at so the account that held a colliding name FIRST keeps
-- the bare handle and later ones take a numeric suffix. Three names collide as
-- of writing -- emersonduong, namduong, quandang, two rows each -- so exactly
-- three rows get a '2'.
--
-- Guarded on handle is null, so a re-run neither renames anybody nor renumbers
-- the suffixes.
-- ---------------------------------------------------------------------------

do $$
declare
    r      record;
    v_base text;
    v_try  text;
    v_n    int;
begin
    for r in
        select user_id, name from public.profiles
         where handle is null
         order by created_at, user_id
    loop
        v_base := public.handle_from_name(r.name);
        v_try  := v_base;
        v_n    := 1;

        while exists (select 1 from public.profiles p where p.handle = v_try)
           or exists (select 1 from public.handle_reservations h where h.handle = v_try)
        loop
            v_n   := v_n + 1;
            -- Truncate the base so base+suffix still fits in 24.
            v_try := left(v_base, 24 - length(v_n::text)) || v_n::text;
        end loop;

        update public.profiles set handle = v_try where user_id = r.user_id;

        insert into public.handle_reservations (handle, user_id)
        values (v_try, r.user_id)
        on conflict (handle) do nothing;
    end loop;
end;
$$;

alter table public.profiles alter column handle set not null;
```

- [ ] **Step 2: Dry-run schema + backfill together, aborting**

Send Task 2's section and this one, then:

```sql
do $t$
declare v_total int; v_distinct int; v_suffixed text; v_res int;
begin
  select count(*), count(distinct handle) into v_total, v_distinct from public.profiles;
  select string_agg(name || ' -> ' || handle, ', ' order by handle)
    into v_suffixed from public.profiles where handle ~ '[0-9]$';
  select count(*) into v_res from public.handle_reservations;
  raise exception E'profiles=% distinct handles=%\nsuffixed: %\nreservations=%',
    v_total, v_distinct, coalesce(v_suffixed, '(none)'), v_res;
end $t$;
```

Expected: `profiles = distinct handles` (28 = 28), exactly three suffixed rows — one each for Emerson Duong, Nam Duong, Quan Dang — and `reservations = 28`.

- [ ] **Step 3: Dry-run idempotency**

In the same aborted transaction, run the backfill `do $$` block a second time and re-check: handles unchanged, still 28 reservations, no renumbering.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_unique_handles.sql
git commit -m "feat(db): 0011 backfill handles, first-come keeps the bare name"
```

---

### Task 4: Migration 0011 — signup assigns a handle

**Files:**
- Modify: `supabase/migrations/0011_unique_handles.sql` (append)

**Interfaces:**
- Consumes: `handle_from_name`
- Produces: `handle_new_user` assigning `handle` and a reservation row

- [ ] **Step 1: Append**

```sql
-- ---------------------------------------------------------------------------
-- Signup.
--
-- The Register form is unchanged: it already collects a display name and
-- passes it through raw_user_meta_data. Adding a handle field would put an
-- availability check inside a flow that cannot recover from failure, so the
-- handle is assigned here and changed later from Edit profile -- which is
-- TikTok's own behaviour.
--
-- CREATE OR REPLACE preserves the revoke from 0001; restated below anyway so
-- this file is self-contained.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_name   text;
    v_base   text;
    v_handle text;
    v_n      int := 1;
begin
    v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
    v_base := public.handle_from_name(v_name);
    v_handle := v_base;

    while exists (select 1 from public.profiles p where p.handle = v_handle)
       or exists (select 1 from public.handle_reservations h where h.handle = v_handle)
    loop
        v_n := v_n + 1;
        v_handle := left(v_base, 24 - length(v_n::text)) || v_n::text;
    end loop;

    insert into public.profiles (user_id, name, image, bio, handle)
    values (
        new.id,
        v_name,
        -- Must match NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID in .env.
        'placeholder-avatar.png',
        '',
        v_handle
    )
    on conflict (user_id) do nothing;

    insert into public.handle_reservations (handle, user_id)
    values (v_handle, new.id)
    on conflict (handle) do nothing;

    return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
```

- [ ] **Step 2: Dry-run a simulated signup, aborting**

Sections 1–3 plus this, then insert directly into `auth.users` to fire the trigger and assert a profile with a legal handle appears; repeat with `raw_user_meta_data` of `{"name": "!!!"}` and assert the fallback yields a `user`-prefixed handle. End with `raise exception` reporting both handles.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_unique_handles.sql
git commit -m "feat(db): 0011 assign a handle at signup"
```

---

### Task 5: Migration 0011 — availability and rename RPCs

**Files:**
- Modify: `supabase/migrations/0011_unique_handles.sql` (append)

**Interfaces:**
- Produces: `public.handle_available(p_handle text) returns boolean`, `public.set_handle(p_handle text) returns text`

- [ ] **Step 1: Append**

```sql
-- ---------------------------------------------------------------------------
-- Availability and rename.
--
-- handle_available is ADVISORY. The unique index and the reservations primary
-- key are the actual enforcement, because any check-then-act is a race. The
-- client uses it to colour a field, not to decide whether a write will succeed.
-- ---------------------------------------------------------------------------

create or replace function public.handle_available(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p_handle ~ '^[a-z0-9._]{2,24}$'
       and not exists (
           select 1 from public.handle_reservations h
            where h.handle = p_handle
              and h.user_id <> (select auth.uid())
       );
$$;

-- Validates, reserves, releases the old reservation and updates the profile in
-- one transaction. Raises on a taken handle: that is the expected path when
-- two people race, not an exceptional one, and the client must render it.
create or replace function public.set_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := (select auth.uid());
    v_old text;
begin
    if v_uid is null then
        raise exception 'You must be signed in to change your handle'
            using errcode = '28000';
    end if;

    if p_handle !~ '^[a-z0-9._]{2,24}$' then
        raise exception 'Handles are 2-24 characters of lowercase letters, numbers, dots and underscores'
            using errcode = '22023';
    end if;

    select handle into v_old from public.profiles where user_id = v_uid;

    if v_old = p_handle then
        return p_handle;
    end if;

    if exists (select 1 from public.handle_reservations h
                where h.handle = p_handle and h.user_id <> v_uid) then
        raise exception 'That handle is taken' using errcode = '23505';
    end if;

    insert into public.handle_reservations (handle, user_id)
    values (p_handle, v_uid)
    on conflict (handle) do update set released_at = null
      where public.handle_reservations.user_id = v_uid;

    update public.profiles set handle = p_handle where user_id = v_uid;

    -- The old handle stays reserved to this account forever; released_at is a
    -- record of when it stopped being current, NOT permission to reuse it.
    update public.handle_reservations
       set released_at = now()
     where handle = v_old and user_id = v_uid;

    return p_handle;
end;
$$;

revoke execute on function public.handle_available(text) from public, anon;
grant  execute on function public.handle_available(text) to authenticated;
revoke execute on function public.set_handle(text)       from public, anon;
grant  execute on function public.set_handle(text)       to authenticated;
```

- [ ] **Step 2: Dry-run, aborting**

As `authenticated` with a real `sub`, assert in one transaction: a valid unused handle returns true from `handle_available` and succeeds through `set_handle`; the previous handle now has `released_at` set and `handle_available` returns **false** for it when asked as a *different* user; another account calling `set_handle` on the released handle raises `23505`; the original owner can take their old handle back; an illegal handle raises `22023`; `anon` calling either RPC is refused.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_unique_handles.sql
git commit -m "feat(db): 0011 handle_available and set_handle"
```

---

### Task 6: Migration 0011 — mentions resolve by handle

**Files:**
- Modify: `supabase/migrations/0011_unique_handles.sql` (append)

**Interfaces:**
- Consumes: `profiles.handle`
- Produces: `notify_post_mentions` / `notify_comment_mentions` joining on `handle`

- [ ] **Step 1: Append**

Restate both functions from `0010_mention_notifications.sql` verbatim with exactly two changes each, and no others:

1. `join public.profiles pr on public.mention_key(pr.name) = t.key`
   becomes `join public.profiles pr on pr.handle = t.key`
2. Delete the ambiguity guard entirely:
   `and (select count(*) from public.profiles amb where public.mention_key(amb.name) = t.key) = 1`

Both keep `security definer`, `set search_path = public, pg_temp`, the 10-token cap, the self-skip, the comment version's `v_skip` suppression, and `on conflict ... do nothing`. `CREATE OR REPLACE` with an unchanged signature, so the grants from 0010 survive — restate the two `revoke execute` lines anyway.

Then, in the same section:

```sql
-- mention_key still normalises the TOKEN and its parity fixture still pins
-- client and server together. What changed is only what the normalised token
-- is compared against, so the expression index on profiles is now dead.
drop index if exists public.profiles_mention_key_idx;
```

- [ ] **Step 2: Dry-run, aborting**

Re-run Task 6 of the 0010 verification, adapted: a caption mentioning a unique handle notifies; a self-mention is skipped; **a caption mentioning `@emersonduong` now notifies exactly the account holding that handle**, where before 0011 it notified nobody; the comment suppression still holds; a caption mentioning a handle nobody holds notifies nobody.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_unique_handles.sql
git commit -m "feat(db): 0011 resolve mentions by handle, drop the ambiguity guard"
```

---

### Task 7: Migration 0011 — feed_post and the body-only RPCs

**Files:**
- Modify: `supabase/migrations/0011_unique_handles.sql` (append)

**Interfaces:**
- Produces: `feed_post.profile_handle text`; `get_feed`, `get_following_feed`, `get_post`, `get_posts_by_hashtag`, `get_user_posts`, `search_videos`, `search_top` returning it

- [ ] **Step 1: Append**

```sql
-- ---------------------------------------------------------------------------
-- feed_post gains the handle.
--
-- Six functions return SETOF feed_post, so one ALTER TYPE serves all of them
-- and each body changes by CREATE OR REPLACE -- which means their grants
-- survive. Verified against production before this was written: ALTER TYPE ...
-- ADD ATTRIBUTE succeeds with all six dependent functions in place.
--
-- Appended rather than inserted next to profile_name: attribute order is part
-- of the composite's wire format, and a client reading positionally would
-- shift. Nothing here reads positionally, but the cost of appending is zero.
-- ---------------------------------------------------------------------------

do $$
begin
    alter type public.feed_post add attribute profile_handle text;
exception when duplicate_column then null;
end;
$$;
```

Then `create or replace` each of the six, changing only the `select` list to add `pr.handle` in the position matching the new attribute. Take each body verbatim from `pg_get_functiondef` rather than from memory. `search_top` returns `jsonb` — add a `handle` key wherever it builds a profile object.

- [ ] **Step 2: Verify grants survived**

Before and after, in the same aborted transaction, compare `proacl` for all seven. They must be byte-identical — that is the whole reason these are `CREATE OR REPLACE` and not `DROP`.

- [ ] **Step 3: Dry-run a read**

`select profile_name, profile_handle from public.get_feed(null, 3, null)` as `anon` — three rows, every `profile_handle` non-null and matching that user's `profiles.handle`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_unique_handles.sql
git commit -m "feat(db): 0011 add profile_handle to feed_post"
```

---

### Task 8: Migration 0011 — the ten signature changes

**Files:**
- Modify: `supabase/migrations/0011_unique_handles.sql` (append)

**Interfaces:**
- Produces: `handle` on `get_blocked_accounts`, `get_comment_replies`, `get_followers`, `get_following_accounts`, `get_muted_accounts`, `get_notifications`, `get_post_comments`, `get_profile`, `get_trending_creators`, `search_users`

- [ ] **Step 1: Capture the current ACLs first**

```sql
select p.proname, array_to_string(p.proacl, ' | ') as acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'get_blocked_accounts','get_comment_replies','get_followers','get_following_accounts',
  'get_muted_accounts','get_notifications','get_post_comments','get_profile',
  'get_trending_creators','search_users')
order by p.proname;
```

Save this output. Step 3 asserts against it.

- [ ] **Step 2: Append, one function at a time**

For each of the ten: `drop function if exists public.<name>(<exact arg types>);` then `create ...` with the body taken verbatim from `pg_get_functiondef`, adding a `handle text` column to the `returns table (...)` and `pr.handle` in the matching select position. Immediately after each `create`, restate its grant:

```sql
-- Readable logged out.
revoke execute on function public.get_post_comments(uuid, jsonb, integer) from public;
grant  execute on function public.get_post_comments(uuid, jsonb, integer) to anon, authenticated;

-- Requires a session.
revoke execute on function public.get_blocked_accounts(integer) from public, anon;
grant  execute on function public.get_blocked_accounts(integer) to authenticated;
```

Use the ACLs captured in Step 1 to decide which of the two shapes each function gets. `search_users` additionally gains handle matching:

```sql
    where (pr.name ilike '%' || p_query || '%' or pr.handle like '%' || lower(p_query) || '%')
```

- [ ] **Step 3: Assert every ACL came back identical**

Re-run Step 1's query. Diff against the saved output. **Any function whose ACL changed is a bug — that is the 0006 failure reproducing.** Fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_unique_handles.sql
git commit -m "feat(db): 0011 thread handle through the ten table-returning RPCs"
```

---

### Task 9: Apply 0011 to production

**Files:** none

- [ ] **Step 1: Transcribe and checksum**

Copy the migration into the `apply_migration` call, `diff` against the file, confirm matching `shasum -a 256`. Do not apply on a mismatch.

- [ ] **Step 2: Apply**

MCP `apply_migration`, name `unique_handles`.

- [ ] **Step 3: Verify against the catalog**

Confirm: `profiles.handle` is `not null`; 28 distinct handles; `profiles_handle_key` exists; `handle_reservations` has 28 rows and RLS on with no `anon`/`authenticated` grants; `profiles_mention_key_idx` is gone; `feed_post` has `profile_handle`; all ten ACLs match the saved output; migration history ends with `unique_handles`.

- [ ] **Step 4: Confirm the deployed client is unaffected**

The live app still runs the old bundle. Hit `get_feed`, `get_post_comments`, `get_profile`, `search_users` over PostgREST with the anon key and confirm HTTP 200 and unchanged existing keys. **This is the backward-compatibility claim being tested, not assumed.**

---

### Task 10: Client — types and the nine render sites

**Files:**
- Modify: `app/types.tsx`, `app/activity/page.tsx:226`, `app/explore/page.tsx:316,530`, `app/components/PostMain.tsx:930`, `app/components/post/CommentThread.tsx:482`, `app/profile/[id]/page.tsx:235`, `app/layouts/includes/MenuItemFollow.tsx:29`, `app/components/upload/CaptionComposer.tsx:334`, `app/layouts/includes/TopNav.tsx:149`
- Modify: `app/utils/notifications.ts` (add `actor_handle`), `app/utils/accountList.ts`, `app/utils/comments.ts`, `app/utils/feed.ts` as their row types require

- [ ] **Step 1: Add `handle` to every profile-shaped type**
- [ ] **Step 2: Change each `@{...name}` to `@{...handle}`**

The profile header at `app/profile/[id]/page.tsx:234-235` is the one that changes meaning rather than just source: the first line stays `{name}`, the second becomes `@{handle}`, and it stops being a duplicate of the first.

- [ ] **Step 3: `npx tsc --noEmit`** — this is the real test for this task; a missed site is a type error.
- [ ] **Step 4: `npm test`**
- [ ] **Step 5: Commit**

---

### Task 11: Client — edit profile gains a handle field

**Files:**
- Modify: `app/components/profile/EditProfileOverlay.tsx`
- Modify: `app/hooks/useUpdateProfile.tsx` or add `app/utils/handleRpc.ts` wrapping `set_handle`

**Interfaces:**
- Consumes: `handleError` (Task 1), `handle_available` / `set_handle` (Task 5)

- [ ] **Step 1: Add the field** — separate from the display name, with the "Username" copy moving to it. The display name field stops calling itself a username, which is the copy bug that started this whole thread.
- [ ] **Step 2: Debounced availability** — `handleError` locally first (no round trip for a malformed handle), then `handle_available` on a 300ms debounce.
- [ ] **Step 3: Save through `set_handle`** — and render its raised message. A `23505` is "That handle is taken", not a crash.
- [ ] **Step 4: `tsc`, `npm test`, commit**

---

### Task 12: Client — composer and mention resolution

**Files:**
- Modify: `app/components/upload/CaptionComposer.tsx`
- Modify: `app/utils/mentions.ts`

- [ ] **Step 1: Composer inserts `@handle`** on pick, and suggests against handle as well as name.
- [ ] **Step 2: Collapse `resolveMentionUserId`** to `supabase.from('profiles').select('user_id').eq('handle', key).maybeSingle()`.

Delete the localStorage registry, the feed-cache scan, and the negative TTL. All three exist only because a name lookup was unreliable; a unique indexed handle is not. `rememberMention` goes with them — check its call site in `CaptionComposer.tsx:324`.

- [ ] **Step 3: `mentionKey` and its fixture are unchanged.** The token normaliser is still correct.
- [ ] **Step 4: `tsc`, `npm test`, commit**

---

### Task 13: Docs and PR

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-08-25-unique-handles-design.md` (status → implemented)

- [ ] **Step 1: README** — add the `0011` entry to the migration list in the established shape, marked **required**, saying what breaks without it.
- [ ] **Step 2: Verify in the browser** — profile header shows display name over a real handle; edit-profile availability states; a mention inserted from the composer resolves.
- [ ] **Step 3: Open the PR** against `main` with a preview deploy, noting that 0011 is already applied to production and why that ordering is safe.

---

## Self-review

**Spec coverage.** Data model → Task 2. Charset → Tasks 1, 2. Backfill → Task 3. Signup → Task 4. Rename and availability → Task 5. Mention resolution → Task 6. RPC surface, both halves → Tasks 7, 8. Client changes → Tasks 10, 11, 12. Testing → the dry-run step inside each task, plus Task 13 Step 2. Out-of-scope items appear in no task, correctly.

**Type consistency.** `handle_from_name(text) returns text` is defined in Task 2 and consumed by Tasks 3 and 4 under that name. `handle_available(text)` and `set_handle(text)` are defined in Task 5 and consumed in Task 11. `isValidHandle` / `handleError` are defined in Task 1 and consumed in Task 11. `feed_post.profile_handle` is named in Task 7 and read in Task 10. `mention_key` keeps its 0010 signature throughout.

**Known gap, deliberately left.** Task 8 says "body taken verbatim from `pg_get_functiondef`" rather than reproducing ten function bodies here. Copying ~14KB of existing SQL into a plan would make the plan the second source of truth for code that already exists in `supabase/migrations/`, and a stale copy is worse than a pointer. The instruction is mechanical and the ACL assertion in Step 3 is what catches a mistake.
