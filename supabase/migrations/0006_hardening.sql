-- Security hardening + the notification type filter.
-- Run after 0005_post_captions.sql. Idempotent -- safe to re-run.
--
-- Three things, two of which close holes that RLS alone was never going to
-- catch, because RLS restricts WHICH ROWS a user may touch and says nothing
-- about WHICH COLUMNS, or about storage objects it does not own.

-- ---------------------------------------------------------------------------
-- 1. Storage: ownership, not just bucket membership.
--
-- 0001_init.sql scoped both write policies to `bucket_id = 'media'` and nothing
-- else. Any authenticated user could therefore delete any other creator's video,
-- delete the shared placeholder-avatar.png (breaking the default avatar for
-- every account at once), or delete-then-insert to substitute their own file at
-- somebody else's key.
--
-- storage.objects.owner is set to auth.uid() by the Storage API on upload, so it
-- is the predicate that was missing. Public SELECT is unchanged: the bucket is
-- public and the feed has to work logged out.
--
-- Same exception handling as 0001: some projects do not grant the SQL editor
-- role ownership of storage.objects, and that must not roll back section 2.
-- ---------------------------------------------------------------------------

do $$
begin
    drop policy if exists "media_public_read" on storage.objects;
    create policy "media_public_read" on storage.objects
        for select using (bucket_id = 'media');

    drop policy if exists "media_authenticated_insert" on storage.objects;
    create policy "media_authenticated_insert" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'media' and owner = (select auth.uid()));

    -- No UPDATE policy at all: overwriting an existing object in place is not
    -- something the app does, and leaving it ungranted means an attacker cannot
    -- swap the bytes under a key that is already referenced by a post row.
    drop policy if exists "media_authenticated_update" on storage.objects;

    drop policy if exists "media_authenticated_delete" on storage.objects;
    create policy "media_authenticated_delete" on storage.objects
        for delete to authenticated
        using (bucket_id = 'media' and owner = (select auth.uid()));
exception
    when insufficient_privilege then
        raise notice 'Could not update storage policies (%). Set them by hand under Storage → Policies for the media bucket: public SELECT; authenticated INSERT and DELETE, both with `owner = auth.uid()`.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Column-level UPDATE grants.
--
-- posts_update_own / profiles_update_own restrict updates to the caller's own
-- rows but grant every column, so a user could PATCH their own
-- posts.like_count / view_count / share_count / repost_count, or
-- profiles.follower_count, to any value. Those columns are direct inputs to
-- feed_rank_score(), so this was feed manipulation, not a cosmetic number.
--
-- The counters stay correct because every trigger that maintains them
-- (bump_post_counter, bump_follow_counters, bump_profile_post_count) and every
-- RPC that touches them (record_watch, record_share) is SECURITY DEFINER, and
-- so runs with the function owner's privileges rather than the caller's.
--
-- service_role is deliberately untouched: scripts/media/* and scripts/seed/*
-- use it and are expected to bypass all of this.
-- ---------------------------------------------------------------------------

revoke update on public.posts from anon, authenticated;
grant  update (text, deleted_at) on public.posts to authenticated;

revoke update on public.profiles from anon, authenticated;
grant  update (name, bio, image) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_notifications gains a type filter.
--
-- The Activity page filtered its tabs with a client-side .filter() over the
-- 30 rows it had already fetched, so a burst of likes made the Comments and
-- Followers tabs read "nothing yet" while the rows sat on page 2 -- the exact
-- failure the pre-table implementation had, reintroduced one layer up.
--
-- Dropped first, not replaced: adding a parameter to an existing signature
-- creates an OVERLOAD, and PostgREST cannot choose between two candidates when
-- called with only p_cursor and p_limit.
-- ---------------------------------------------------------------------------

drop function if exists public.get_notifications(jsonb, integer);
drop function if exists public.get_notifications(jsonb, integer, text);

create or replace function public.get_notifications(
    p_cursor jsonb   default null,
    p_limit  integer default 30,
    p_type   text    default null
)
returns table (
    id              uuid,
    type            text,
    created_at      timestamptz,
    read_at         timestamptz,
    actor_id        uuid,
    actor_name      text,
    actor_image     text,
    post_id         uuid,
    post_poster_key text,
    post_media      text,
    preview         text
)
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
           n.post_id, coalesce(p.poster_key, ''), coalesce(p.video_url, ''), n.preview
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

-- Serves the filtered read above; notifications_user_created_idx from 0002
-- cannot skip the non-matching types on its own.
create index if not exists notifications_user_type_created_idx
    on public.notifications (user_id, type, created_at desc);

notify pgrst, 'reload schema';
