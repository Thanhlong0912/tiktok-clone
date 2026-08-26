-- Unique handles. Run after 0010. Idempotent -- safe to re-run.
--
-- public.profiles.name has been doing two jobs it cannot both do: the display
-- name rendered at 30px on the profile header, and the identity every @mention
-- resolves against. It is declared `text not null` with no length, charset or
-- uniqueness constraint, and the only validation anywhere in the app is "not
-- empty".
--
-- The consequences were live. The profile header rendered the same value
-- twice, so an account read `Rowan Bui` over `@Rowan Bui`. Three mention keys
-- collided across 28 accounts, and 0010 deliberately notifies NOBODY for an
-- ambiguous key, so six accounts could not be mentioned at all.
--
-- This file adds the second field. `name` stays the display name and stops
-- being an identity; `handle` becomes the identity and is never a display.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The column.
--
-- Lowercase-only is load-bearing rather than stylistic: it makes the column its
-- own canonical form, so uniqueness needs no lower() expression index and no
-- citext extension, and the unique index means exactly what it says. Dots and
-- underscores are allowed because they are what people expect of a handle;
-- nothing else is, which keeps a handle unambiguous inside a caption where @,
-- # and whitespace are what terminate the token.
--
-- Mirrored by HANDLE_PATTERN in app/utils/handle.ts, pinned by the fixture in
-- app/utils/handle.test.ts.
--
-- NOT NULL is applied in section 6, after both the backfill and
-- handle_new_user exist, so the constraint is not racing the rows it
-- constrains. The CHECK can go on now: it passes on NULL, which is exactly
-- the window the backfill needs.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. Reservations.
--
-- Every handle an account has ever held. released_at null means "in use"; a
-- non-null released_at is a record of when the handle stopped being current,
-- NOT permission to reuse it.
--
-- This table is the difference between "currently taken" and "can never be
-- taken", and it exists because mentions are literal text inside posts.text
-- and comments.text. Nothing rewrites a caption when an account renames. So if
-- @rowanbui were released and someone else claimed it, every historical
-- caption mentioning @rowanbui would begin linking to -- and, through the 0010
-- triggers, notifying -- a different person. That is impersonation by
-- inheritance, and a unique index alone does not prevent it.
--
-- Not exposed through the API at all. Availability is answered by
-- handle_available in section 7, which is SECURITY DEFINER; reading the table
-- directly would let anyone enumerate every handle every account has ever
-- used, including ones they have since moved away from.
-- ---------------------------------------------------------------------------

create table if not exists public.handle_reservations (
    handle      text primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    created_at  timestamptz not null default now(),
    released_at timestamptz
);

-- Covers the FK, so deleting an account does not sequentially scan this table.
create index if not exists handle_reservations_user_idx
    on public.handle_reservations (user_id);

alter table public.handle_reservations enable row level security;

-- RLS with no policy denies everything to anon and authenticated, which is the
-- intent. The revoke is belt and braces for the same reason 0007 revoked
-- UPDATE on comment_likes: where there is no legitimate caller, leaving the
-- privilege ungranted removes the surface instead of policing it.
revoke all on public.handle_reservations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Derivation, shared by the backfill and by handle_new_user.
--
-- mention_key first, deliberately: every mention already written into a
-- caption was written against mention_key(name), so deriving handles the same
-- way is what keeps those existing mentions resolving. Any unrelated
-- derivation would silently orphan them.
--
-- Then fold accents and strip anything outside the charset, and this is the
-- one place the two normalisers must not be confused. mention_key preserves
-- punctuation and accents ON PURPOSE, because @O'Brien and @OBrien are two
-- different people to a token resolver. A stored handle cannot: O'Brien must
-- become obrien or the insert violates the CHECK above.
--
-- The folding is NFD plus a strip of everything illegal, which decomposes an
-- accented letter into a base letter and combining marks and then drops the
-- marks. Stripping alone was the first implementation and it was wrong for
-- this app's users: it turns Nguyễn Văn A into `nguynvna` and Thành into
-- `thnh`, because it deletes the accented letters outright rather than
-- reducing them. NFD gives `nguyenvana` and `thanh`.
--
-- The explicit replace of `đ` is not redundant with NFD. U+0111 LATIN SMALL
-- LETTER D WITH STROKE has no canonical decomposition -- the stroke is part of
-- the glyph, not a combining mark -- so NFD leaves it intact and the strip
-- then deletes it. Without this line Đặng Quân becomes `angquan`, losing the
-- first letter of the name. With it, `dangquan`.
--
-- All 28 rows present when this was written are plain ASCII letters and
-- spaces, so every step after mention_key is a no-op for them and backfill
-- continuity with existing captions is total. The folding is for names that
-- arrive later.
--
-- Total by construction: a name that reduces to fewer than two legal
-- characters yields 'user', which the caller then makes unique. A trigger that
-- can reject an account creation is a trigger that can lock somebody out of
-- the product, so this function has no failure mode.
-- ---------------------------------------------------------------------------

create or replace function public.handle_from_name(p_name text)
returns text
language sql
immutable
parallel safe
as $$
    select case
        when length(d.base) >= 2 then left(d.base, 24)
        else 'user'
    end
    from (
        select pg_catalog.regexp_replace(
                   normalize(replace(public.mention_key(coalesce(p_name, '')), 'đ', 'd'), NFD),
                   '[^a-z0-9._]', '', 'g') as base
    ) d;
$$;

-- ---------------------------------------------------------------------------
-- 4. Backfill.
--
-- Ordered by created_at so the account that held a colliding name FIRST keeps
-- the bare handle and later ones take a numeric suffix. Three names collide as
-- of writing -- emersonduong, namduong, quandang, two rows each -- so exactly
-- three rows get a '2'.
--
-- The suffix loop checks handle_reservations as well as profiles, so a handle
-- released by an earlier rename is never handed to somebody else here either.
-- Truncating the base before appending keeps base+suffix inside 24 characters,
-- which matters for a name that already sits at the limit.
--
-- Guarded on `handle is null`, so a re-run neither renames anybody nor
-- renumbers the suffixes. That guard is what makes this file idempotent: an
-- unguarded backfill would reassign every handle on every run, and a handle
-- that changes underneath its own reservation is exactly the impersonation
-- case section 2 exists to prevent.
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
            v_try := left(v_base, 24 - length(v_n::text)) || v_n::text;
        end loop;

        update public.profiles set handle = v_try where user_id = r.user_id;

        insert into public.handle_reservations (handle, user_id)
        values (v_try, r.user_id)
        on conflict (handle) do nothing;
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Signup assigns a handle.
--
-- The Register form is deliberately unchanged. It already collects a display
-- name and passes it through raw_user_meta_data, and adding a handle field
-- would put an availability check inside a flow that cannot recover from
-- failure -- a taken handle would have to fail the signup or silently pick
-- something else, and both are worse than assigning one now and letting the
-- account change it from Edit profile. That is TikTok's own behaviour.
--
-- CREATE OR REPLACE preserves the revoke from 0001; restated below anyway so
-- this file is self-contained and the grant cannot drift out from under the
-- replacement, which is the discipline 0007 established.
--
-- Placed before section 6's NOT NULL constraint, not after: applied
-- statement-at-a-time rather than in one transaction, that ordering is what
-- keeps a signup landing in between from ever inserting a null handle. The
-- old (pre-0011) handle_new_user does not know about this column at all, so
-- if the constraint went on first, a signup in that window would insert with
-- a null handle and be rejected outright.
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

-- ---------------------------------------------------------------------------
-- 6. Handle becomes mandatory.
--
-- Deliberately last of the three handle-populating steps: the backfill
-- (section 4) fills every existing row and handle_new_user (section 5) makes
-- every new signup fill its own, so by the time this statement runs there is
-- no path -- historical or new -- left that can produce a null handle for it
-- to reject. Kept after handle_new_user rather than immediately after the
-- backfill (where an earlier draft of this file had it) for exactly that
-- reason: applied statement-at-a-time instead of in one transaction, the
-- earlier position left a window where the old handle_new_user was still
-- installed and this constraint already active, and a signup landing in that
-- window would insert a null handle and fail.
-- ---------------------------------------------------------------------------

alter table public.profiles alter column handle set not null;

-- ---------------------------------------------------------------------------
-- 7. Availability and rename.
--
-- handle_available is ADVISORY and nothing more. The unique index and the
-- reservations primary key are the actual enforcement, because any
-- check-then-act is a race: two people can both be told "available" and only
-- one insert can win. The client uses this to colour a field, never to decide
-- whether a write will succeed.
--
-- It is SECURITY DEFINER because handle_reservations is not readable through
-- the API -- that is the whole point of section 2 -- so answering the question
-- requires privilege the caller does not have. The function returns a boolean
-- and never the row, so it cannot be used to enumerate who held what.
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

-- Validates, reserves, releases the previous reservation and updates the
-- profile in one transaction.
--
-- Raising on a taken handle is the EXPECTED path when two people race, not an
-- exceptional one, and the client is required to render it rather than treat
-- it as a crash.
--
-- The actor comes from (select auth.uid()) and never from an argument, per the
-- rule 0003 set for every writer in this schema. A p_user_id parameter on a
-- SECURITY DEFINER writer is exactly how "rename somebody else" ships by
-- accident.
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

    -- Setting your own handle to what it already is is a no-op, not an error.
    -- Without this the reservation check below would find your own row and the
    -- update would pointlessly release and re-take the same handle.
    if v_old = p_handle then
        return p_handle;
    end if;

    if exists (select 1 from public.handle_reservations h
                where h.handle = p_handle and h.user_id <> v_uid) then
        raise exception 'That handle is taken' using errcode = '23505';
    end if;

    -- Re-taking a handle you released before: clear released_at rather than
    -- inserting a duplicate. The WHERE on the DO UPDATE is what stops this
    -- from quietly stealing somebody else's reservation if the guard above
    -- were ever weakened.
    insert into public.handle_reservations (handle, user_id)
    values (p_handle, v_uid)
    on conflict (handle) do update set released_at = null
      where public.handle_reservations.user_id = v_uid;

    update public.profiles set handle = p_handle where user_id = v_uid;

    -- The old handle stays reserved to this account forever. released_at
    -- records when it stopped being current; it is NOT permission to reuse it,
    -- and nothing in this schema ever deletes a reservation row.
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

-- ---------------------------------------------------------------------------
-- 8. Mentions resolve by handle.
--
-- Both functions are 0010's verbatim, with exactly two changes each and no
-- others:
--
--   1. The join becomes `pr.handle = t.key` instead of
--      `public.mention_key(pr.name) = t.key`.
--   2. The ambiguity guard is DELETED. It read
--      `(select count(*) from public.profiles amb
--         where public.mention_key(amb.name) = t.key) = 1`
--      and existed only because profiles.name is not unique. profiles.handle
--      is, so the guard can no longer fire, and a guard that cannot fire is
--      worse than no guard: the next reader has to work out whether it is
--      load-bearing.
--
-- This is the change that makes the six previously-unmentionable accounts
-- mentionable. Under 0010 a caption saying @emersonduong notified nobody,
-- because the key matched two rows.
--
-- mention_key survives and is unchanged. It is still the right normaliser for
-- the TOKEN -- it lowercases and strips a stray @ -- and its parity fixture in
-- app/utils/mentions.test.ts still pins client and server together. What
-- changed is only what the normalised token is compared against. That the
-- comparison now works is a property of the CHECK on handle: a handle is
-- already lowercase and already free of whitespace, so mention_key(token)
-- and handle live in the same space.
--
-- Signatures are unchanged, so CREATE OR REPLACE preserves the grants from
-- 0010. Restated at the end of the section regardless.
-- ---------------------------------------------------------------------------

create or replace function public.notify_post_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.deleted_at is not null then
        return null;
    end if;

    with raw as (
        select public.mention_key(r.m[1]) as key, r.ord
        from regexp_matches(new.text, '@([^\s#@]+)', 'g') with ordinality as r(m, ord)
    ),
    tokens as (
        select key, min(ord) as first_ord
        from raw
        where key <> ''
        group by key
        order by min(ord)
        limit 10
    )
    insert into public.notifications (user_id, actor_id, type, post_id, preview)
    select pr.user_id, new.user_id, 'mention', new.id, left(new.text, 140)
    from tokens t
    join public.profiles pr on pr.handle = t.key
    where pr.user_id <> new.user_id
    on conflict (user_id, actor_id, type,
                 coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do nothing;

    return null;
end;
$$;

create or replace function public.notify_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_skip uuid;
begin
    if new.deleted_at is not null then
        return null;
    end if;

    -- Identical to notify_comment_author's target resolution.
    if new.parent_id is not null then
        select c.user_id into v_skip
          from public.comments c
         where c.id = new.parent_id;
    end if;

    if v_skip is null or v_skip = new.user_id then
        select p.user_id into v_skip
          from public.posts p
         where p.id = new.post_id;
    end if;

    with raw as (
        select public.mention_key(r.m[1]) as key, r.ord
        from regexp_matches(new.text, '@([^\s#@]+)', 'g') with ordinality as r(m, ord)
    ),
    tokens as (
        select key, min(ord) as first_ord
        from raw
        where key <> ''
        group by key
        order by min(ord)
        limit 10
    )
    insert into public.notifications (user_id, actor_id, type, post_id, comment_id, preview)
    select pr.user_id, new.user_id, 'mention', new.post_id, new.id, left(new.text, 140)
    from tokens t
    join public.profiles pr on pr.handle = t.key
    where pr.user_id <> new.user_id
      and pr.user_id is distinct from v_skip
    -- comment_id is not part of the dedup key, so a second mention of the same
    -- person by the same actor on the same post keeps pointing at the first
    -- comment. The post is the same either way.
    on conflict (user_id, actor_id, type,
                 coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do nothing;

    return null;
end;
$$;

revoke execute on function public.notify_post_mentions()    from public, anon, authenticated;
revoke execute on function public.notify_comment_mentions() from public, anon, authenticated;

-- Built by 0010 to serve the old name-based resolution, which no longer
-- exists. mention_key itself stays -- it normalises tokens -- but nothing
-- looks a profile up by it any more.
drop index if exists public.profiles_mention_key_idx;

-- ---------------------------------------------------------------------------
-- 9. The ten RETURNS TABLE functions gain a handle column.
--
-- Every other function touched by this migration could use CREATE OR REPLACE
-- and keep its existing grants, because REPLACE is only disallowed when the
-- return type changes. These ten all return TABLE(...), and appending a
-- column to that list IS a return-type change -- Postgres rejects it with
-- "cannot change return type of existing function". So each one is DROPped
-- and recreated from scratch instead of replaced in place.
--
-- That has one immediate consequence for every function on this list: DROP
-- removes the pg_proc row, and the row is what the ACL (proacl) lives on.
-- Recreating the function does not restore the old grants -- it creates a
-- fresh row with Postgres's default privilege, which is EXECUTE granted to
-- PUBLIC. Because every authenticated request and every anonymous request is
-- also, trivially, PUBLIC, a bare drop/recreate silently turns three
-- authenticated-only functions (get_blocked_accounts, get_muted_accounts,
-- get_notifications -- each of which answers with data scoped to the caller)
-- back into public-readable ones. That is the exact failure 0006's history
-- warns about. The fix is the same discipline used everywhere else in this
-- file: every drop/create pair below is immediately followed by its own
-- revoke/grant, restated rather than assumed.
--
-- Definitions are pg_get_functiondef output, reproduced verbatim (modulo
-- keyword casing and $$ in place of $function$, to match this file's style)
-- with exactly two edits per function: the new column on RETURNS TABLE, and
-- the matching expression on the select list, both appended at the end so
-- neither disturbs the existing column order client code already depends on.
-- get_trending_creators needs a third edit -- pr.handle added to its GROUP
-- BY, since it is the one function here that aggregates -- and search_users
-- needs a fourth: its WHERE now also matches on handle.
--
-- Every predicate that stood in for RLS in the previous body (deleted_at is
-- null, the blocks/mutes not-exists checks, the auth.uid() scoping) is
-- preserved exactly. These are SECURITY DEFINER functions, so those
-- predicates -- not any RLS policy -- are the only thing standing between a
-- caller and rows they should not see, and this section does not touch them.
-- ---------------------------------------------------------------------------

-- 9a. get_notifications. anon never reaches this function at all -- see its
-- authenticated-only grant below -- but the body still checks v_uid is null
-- and returns nothing, exactly as before.

drop function if exists public.get_notifications(jsonb, integer, text);

create or replace function public.get_notifications(p_cursor jsonb default null::jsonb, p_limit integer default 30, p_type text default null::text)
returns table(id uuid, type text, created_at timestamp with time zone, read_at timestamp with time zone, actor_id uuid, actor_name text, actor_image text, post_id uuid, post_poster_key text, post_media text, preview text, actor_handle text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid  uuid        := (select auth.uid());
    v_ts   timestamptz := nullif(p_cursor->>'ts', '')::timestamptz;
    v_id   uuid        := nullif(p_cursor->>'id', '')::uuid;
    v_type text        := nullif(p_type, '');
begin
    if v_uid is null then
        return;
    end if;

    -- Rejected rather than silently ignored: a typo in the tab name should not
    -- quietly return the unfiltered list.
    if v_type is not null and v_type not in ('like', 'comment', 'follow', 'repost', 'mention') then
        raise exception 'unknown notification type %', v_type using errcode = '22023';
    end if;

    return query
    select n.id, n.type, n.created_at, n.read_at,
           n.actor_id, pr.name, pr.image,
           n.post_id, coalesce(p.poster_key, ''), coalesce(p.video_url, ''), n.preview,
           pr.handle
    from public.notifications n
    join public.profiles pr on pr.user_id = n.actor_id
    left join public.posts p on p.id = n.post_id and p.deleted_at is null
    where n.user_id = v_uid
      and (v_type is null or n.type = v_type)
      and not exists (select 1 from public.blocks b
                       where b.blocker_id = v_uid and b.blocked_id = n.actor_id)
      and (v_ts is null or (n.created_at, n.id) < (v_ts, v_id))
    order by n.created_at desc, n.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50);
end;
$$;

revoke execute on function public.get_notifications(jsonb, integer, text) from public, anon;
grant  execute on function public.get_notifications(jsonb, integer, text) to authenticated;

-- 9b. get_post_comments.

drop function if exists public.get_post_comments(uuid, jsonb, integer);

create or replace function public.get_post_comments(p_post_id uuid, p_cursor jsonb default null::jsonb, p_limit integer default 20)
returns table(id uuid, post_id uuid, parent_id uuid, user_id uuid, text text, created_at timestamp with time zone, like_count integer, reply_count integer, is_liked boolean, is_author_liked boolean, is_post_author boolean, profile_name text, profile_image text, profile_handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select c.id, c.post_id, c.parent_id, c.user_id, c.text, c.created_at,
           c.like_count, c.reply_count,
           exists (select 1 from public.comment_likes cl
                    where cl.comment_id = c.id and cl.user_id = (select auth.uid())),
           -- The creator's heart. A primary-key probe, same as is_liked.
           exists (select 1 from public.comment_likes cl
                    where cl.comment_id = c.id and cl.user_id = a.author),
           c.user_id = a.author,
           pr.name, pr.image,
           pr.handle
    from public.comments c
    join public.profiles pr on pr.user_id = c.user_id
    cross join lateral (
        select p.user_id as author
          from public.posts p
         where p.id = p_post_id
           and (p.deleted_at is null or p.user_id = (select auth.uid()))
    ) a
    where c.post_id = p_post_id
      and c.parent_id is null
      and c.deleted_at is null
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = c.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = c.user_id))
      and not exists (select 1 from public.mutes m
                       where m.muter_id = (select auth.uid()) and m.muted_id = c.user_id)
      -- Newest first, matching what the comment list has always shown.
      and (nullif(p_cursor->>'ts', '')::timestamptz is null
           or (c.created_at, c.id)
              < (nullif(p_cursor->>'ts', '')::timestamptz, nullif(p_cursor->>'id', '')::uuid))
    order by c.created_at desc, c.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.get_post_comments(uuid, jsonb, integer) from public;
grant  execute on function public.get_post_comments(uuid, jsonb, integer) to anon, authenticated;

-- 9c. get_comment_replies.

drop function if exists public.get_comment_replies(uuid, jsonb, integer);

create or replace function public.get_comment_replies(p_parent_id uuid, p_cursor jsonb default null::jsonb, p_limit integer default 10)
returns table(id uuid, post_id uuid, parent_id uuid, user_id uuid, text text, created_at timestamp with time zone, like_count integer, reply_count integer, is_liked boolean, is_author_liked boolean, is_post_author boolean, profile_name text, profile_image text, profile_handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select c.id, c.post_id, c.parent_id, c.user_id, c.text, c.created_at,
           c.like_count, c.reply_count,
           exists (select 1 from public.comment_likes cl
                    where cl.comment_id = c.id and cl.user_id = (select auth.uid())),
           exists (select 1 from public.comment_likes cl
                    where cl.comment_id = c.id and cl.user_id = p.user_id),
           c.user_id = p.user_id,
           pr.name, pr.image,
           pr.handle
    from public.comments c
    -- `parent.parent_id is null` here is not redundant with section 4: it is
    -- what makes an id that is ITSELF a reply return empty, rather than
    -- quietly behaving like a third level.
    join public.comments parent
      on parent.id = p_parent_id and parent.parent_id is null and parent.deleted_at is null
    join public.posts p
      on p.id = parent.post_id
     and (p.deleted_at is null or p.user_id = (select auth.uid()))
    join public.profiles pr on pr.user_id = c.user_id
    where c.parent_id = p_parent_id
      and c.deleted_at is null
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = c.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = c.user_id))
      and not exists (select 1 from public.mutes m
                       where m.muter_id = (select auth.uid()) and m.muted_id = c.user_id)
      -- ASC, and the comparison flips with it: a thread is a conversation and
      -- reads oldest-first, unlike the list of comments above it.
      and (nullif(p_cursor->>'ts', '')::timestamptz is null
           or (c.created_at, c.id)
              > (nullif(p_cursor->>'ts', '')::timestamptz, nullif(p_cursor->>'id', '')::uuid))
    order by c.created_at asc, c.id asc
    limit least(greatest(coalesce(p_limit, 10), 1), 30);
$$;

revoke execute on function public.get_comment_replies(uuid, jsonb, integer) from public;
grant  execute on function public.get_comment_replies(uuid, jsonb, integer) to anon, authenticated;

-- 9d. get_blocked_accounts and get_muted_accounts. Both LEFT JOIN profiles
-- because the joined-to account can have been deleted while the block/mute
-- record itself is kept, and both already coalesce name/image/bio for that
-- row-may-not-exist case -- handle gets the same treatment for the same
-- reason.

drop function if exists public.get_blocked_accounts(integer);

create or replace function public.get_blocked_accounts(p_limit integer default 100)
returns table(user_id uuid, name text, image text, bio text, created_at timestamp with time zone, handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select b.blocked_id,
           coalesce(pr.name, 'Unknown account'),
           coalesce(pr.image, ''),
           coalesce(pr.bio, ''),
           b.created_at,
           coalesce(pr.handle, '')
    from public.blocks b
    left join public.profiles pr on pr.user_id = b.blocked_id
    where b.blocker_id = (select auth.uid())
    order by b.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke execute on function public.get_blocked_accounts(integer) from public, anon;
grant  execute on function public.get_blocked_accounts(integer) to authenticated;

drop function if exists public.get_muted_accounts(integer);

create or replace function public.get_muted_accounts(p_limit integer default 100)
returns table(user_id uuid, name text, image text, bio text, created_at timestamp with time zone, handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select m.muted_id,
           coalesce(pr.name, 'Unknown account'),
           coalesce(pr.image, ''),
           coalesce(pr.bio, ''),
           m.created_at,
           coalesce(pr.handle, '')
    from public.mutes m
    left join public.profiles pr on pr.user_id = m.muted_id
    where m.muter_id = (select auth.uid())
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke execute on function public.get_muted_accounts(integer) from public, anon;
grant  execute on function public.get_muted_accounts(integer) to authenticated;

-- 9e. get_followers and get_following_accounts.

drop function if exists public.get_followers(uuid, jsonb, integer);

create or replace function public.get_followers(p_user_id uuid, p_cursor jsonb default null::jsonb, p_limit integer default 24)
returns table(user_id uuid, name text, image text, bio text, follower_count integer, is_following boolean, is_self boolean, followed_at timestamp with time zone, handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count,
           exists (select 1 from public.follows mf
                    where mf.user_id = (select auth.uid()) and mf.to_user_id = pr.user_id),
           pr.user_id is not distinct from (select auth.uid()),
           f.created_at,
           pr.handle
    from public.follows  f
    join public.profiles pr on pr.user_id = f.user_id
    where f.to_user_id = p_user_id
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = pr.user_id))
      and (nullif(p_cursor->>'ts', '')::timestamptz is null
           or (f.created_at, f.user_id)
              < (nullif(p_cursor->>'ts', '')::timestamptz, nullif(p_cursor->>'id', '')::uuid))
    order by f.created_at desc, f.user_id desc
    limit least(greatest(coalesce(p_limit, 24), 1), 48);
$$;

revoke execute on function public.get_followers(uuid, jsonb, integer) from public;
grant  execute on function public.get_followers(uuid, jsonb, integer) to anon, authenticated;

drop function if exists public.get_following_accounts(uuid, jsonb, integer);

create or replace function public.get_following_accounts(p_user_id uuid, p_cursor jsonb default null::jsonb, p_limit integer default 24)
returns table(user_id uuid, name text, image text, bio text, follower_count integer, is_following boolean, is_self boolean, followed_at timestamp with time zone, handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count,
           exists (select 1 from public.follows mf
                    where mf.user_id = (select auth.uid()) and mf.to_user_id = pr.user_id),
           pr.user_id is not distinct from (select auth.uid()),
           f.created_at,
           pr.handle
    from public.follows  f
    join public.profiles pr on pr.user_id = f.to_user_id
    where f.user_id = p_user_id
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = pr.user_id))
      and (nullif(p_cursor->>'ts', '')::timestamptz is null
           or (f.created_at, f.to_user_id)
              < (nullif(p_cursor->>'ts', '')::timestamptz, nullif(p_cursor->>'id', '')::uuid))
    order by f.created_at desc, f.to_user_id desc
    limit least(greatest(coalesce(p_limit, 24), 1), 48);
$$;

revoke execute on function public.get_following_accounts(uuid, jsonb, integer) from public;
grant  execute on function public.get_following_accounts(uuid, jsonb, integer) to anon, authenticated;

-- 9f. get_profile.

drop function if exists public.get_profile(uuid);

create or replace function public.get_profile(p_user_id uuid)
returns table(user_id uuid, name text, image text, bio text, follower_count integer, following_count integer, post_count integer, total_likes bigint, is_following boolean, is_blocked boolean, is_self boolean, handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio,
           pr.follower_count, pr.following_count, pr.post_count,
           coalesce((select sum(p.like_count) from public.posts p
                      where p.user_id = pr.user_id and p.deleted_at is null), 0)::bigint,
           exists (select 1 from public.follows f
                    where f.user_id = (select auth.uid()) and f.to_user_id = pr.user_id),
           exists (select 1 from public.blocks b
                    where b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id),
           pr.user_id = (select auth.uid()),
           pr.handle
    from public.profiles pr
    where pr.user_id = p_user_id;
$$;

revoke execute on function public.get_profile(uuid) from public;
grant  execute on function public.get_profile(uuid) to anon, authenticated;

-- 9g. get_trending_creators. The one function in this section that
-- aggregates, so pr.handle -- unlike every other added expression here --
-- must also be added to the GROUP BY, or Postgres rejects the query with
-- "column pr.handle must appear in the GROUP BY clause". order by 7 still
-- means recent_engagement: appending handle at the end of the select list
-- keeps it out of the way of that ordinal.

drop function if exists public.get_trending_creators(integer);

create or replace function public.get_trending_creators(p_limit integer default 10)
returns table(user_id uuid, name text, image text, bio text, follower_count integer, post_count integer, recent_engagement bigint, is_following boolean, handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count, pr.post_count,
           coalesce(sum(p.like_count + p.comment_count * 2 + p.repost_count * 3)
                    filter (where p.created_at > now() - interval '14 days'), 0)::bigint,
           exists (select 1 from public.follows f
                    where f.user_id = (select auth.uid()) and f.to_user_id = pr.user_id),
           pr.handle
    from public.profiles pr
    left join public.posts p on p.user_id = pr.user_id and p.deleted_at is null
    where pr.user_id is distinct from (select auth.uid())
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = pr.user_id))
    group by pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count, pr.post_count, pr.handle
    order by 7 desc, pr.follower_count desc
    limit least(greatest(coalesce(p_limit, 10), 1), 30);
$$;

revoke execute on function public.get_trending_creators(integer) from public;
grant  execute on function public.get_trending_creators(integer) to anon, authenticated;

-- 9h. search_users. Unlike the other nine, this one also gains a second
-- match path: today a search only tests p_query against the display name,
-- which is exactly the field 0011 stops treating as an identity. Without this
-- change, searching for the handle you know an account by -- as opposed to
-- the display name you might not -- would silently return nothing. name
-- keeps ILIKE (fuzzy, case-insensitive, matches the trigram index this
-- function already relies on for ranking); handle uses plain LIKE against a
-- lower()ed query because the column is already lowercase-only by the CHECK
-- in section 1, so no case folding is needed on that side.

drop function if exists public.search_users(text, integer);

create or replace function public.search_users(p_query text, p_limit integer default 12)
returns table(user_id uuid, name text, image text, bio text, follower_count integer, is_following boolean, rank real, handle text)
language sql
stable security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count,
           exists (select 1 from public.follows f
                    where f.user_id = (select auth.uid()) and f.to_user_id = pr.user_id),
           extensions.similarity(pr.name, p_query),
           pr.handle
    from public.profiles pr
    where (pr.name ilike '%' || p_query || '%' or pr.handle like '%' || lower(p_query) || '%')
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = pr.user_id))
    order by extensions.similarity(pr.name, p_query) desc, pr.follower_count desc
    limit least(greatest(coalesce(p_limit, 12), 1), 30);
$$;

revoke execute on function public.search_users(text, integer) from public;
grant  execute on function public.search_users(text, integer) to anon, authenticated;
