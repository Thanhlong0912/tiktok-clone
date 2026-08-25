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
-- NOT NULL is applied in section 4, after the backfill, so the constraint is
-- not racing the rows it constrains. The CHECK can go on now: it passes on
-- NULL, which is exactly the window the backfill needs.
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
-- handle_available in section 5, which is SECURITY DEFINER; reading the table
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

-- Only now, with every row filled, does the column become mandatory.
alter table public.profiles alter column handle set not null;

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
-- 6. Availability and rename.
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
