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
-- NOT NULL is applied in section 3, after the backfill, so the constraint is
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
