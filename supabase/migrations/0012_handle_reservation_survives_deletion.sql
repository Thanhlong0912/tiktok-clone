-- A handle reservation must outlive the account that held it.
-- Run after 0011. Idempotent -- safe to re-run.
--
-- 0011 created handle_reservations to make a released handle unclaimable
-- rather than merely currently-taken, because mentions are literal text inside
-- posts.text and comments.text and nothing rewrites a caption on rename. If
-- @rowanbui were reclaimed by somebody else, every historical caption
-- mentioning it would begin linking to -- and, through the 0010 triggers,
-- notifying -- a different person.
--
-- The table then undercut itself: user_id was `references auth.users(id) on
-- delete cascade`, so deleting an account deleted its reservations and handed
-- every handle it had ever held straight back to the pool. That is the same
-- impersonation-by-inheritance hole, reached by deleting an account instead of
-- renaming one, and 0011's own comment claimed "nothing in this schema ever
-- deletes a reservation row" while the foreign key did exactly that.
--
-- Not reachable today -- the app has no account-deletion path -- which is
-- precisely why it is worth closing now, before something builds one and
-- inherits the hole silently.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The reservation survives its owner.
--
-- SET NULL rather than RESTRICT: an account must remain deletable. The row
-- stays behind as a tombstone whose only job is to keep the handle out of
-- circulation, so a null user_id means "held by nobody, and still not yours".
--
-- That is also why user_id has to become nullable. It is a weaker column
-- constraint in exchange for a stronger product guarantee, and the FK still
-- holds for every row whose owner exists.
-- ---------------------------------------------------------------------------

alter table public.handle_reservations
    alter column user_id drop not null;

alter table public.handle_reservations
    drop constraint if exists handle_reservations_user_id_fkey;

do $$
begin
    alter table public.handle_reservations
        add constraint handle_reservations_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete set null;
exception when duplicate_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The guards have to learn about NULL, or section 1 opens the hole it closes.
--
-- Both readers asked `h.user_id <> <caller>`. Against a null owner that
-- comparison is NULL, not true -- so the EXISTS finds nothing, and an orphaned
-- reservation would be invisible to exactly the two checks that exist to
-- honour it. Changing the foreign key without changing these would have moved
-- the bug rather than fixed it: the row would survive deletion and then be
-- ignored anyway.
--
-- `is distinct from` is NULL-total: a null owner is "not the caller", so the
-- reservation counts as taken and the handle stays unclaimable by everyone,
-- which is the whole point of keeping the row.
--
-- Signatures are unchanged, so CREATE OR REPLACE preserves the grants 0011
-- set. Restated below anyway, per the discipline 0007 established and 0006's
-- history justifies.
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
              and h.user_id is distinct from (select auth.uid())
       );
$$;

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
    if v_old = p_handle then
        return p_handle;
    end if;

    -- `is distinct from`, matching handle_available above: a reservation whose
    -- owner was deleted belongs to nobody, and nobody is not you.
    if exists (select 1 from public.handle_reservations h
                where h.handle = p_handle and h.user_id is distinct from v_uid) then
        raise exception 'That handle is taken' using errcode = '23505';
    end if;

    insert into public.handle_reservations (handle, user_id)
    values (p_handle, v_uid)
    on conflict (handle) do update set released_at = null
      where public.handle_reservations.user_id = v_uid;

    update public.profiles set handle = p_handle where user_id = v_uid;

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

reset lock_timeout;

notify pgrst, 'reload schema';
