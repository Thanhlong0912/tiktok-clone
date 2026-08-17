-- Creator-supplied subtitle tracks, for the Captions item in the video options
-- menu. Run after 0004_rls_initplan_and_fk_indexes.sql. Idempotent.
--
-- Deliberately a side table rather than a column on public.posts: the feed RPCs
-- all return the public.feed_post composite type, and adding a field to that
-- type means `drop type ... cascade` plus recreating all eight functions. The
-- feed never renders a caption -- the player looks the track up on demand, once
-- per post -- so nothing about the feed path has to change.

create table if not exists public.post_captions (
    id          uuid primary key default gen_random_uuid(),
    post_id     uuid not null references public.posts(id) on delete cascade,
    -- Denormalised from posts.user_id so the RLS write policies do not have to
    -- join, and so the FK index below covers the cascade on user deletion.
    user_id     uuid not null references auth.users(id) on delete cascade,
    lang        text not null default 'en',
    label       text not null default 'English',
    storage_key text not null,
    created_at  timestamptz not null default now(),
    unique (post_id, lang)
);

-- Both foreign keys need a covering index or deleting a post/user sequentially
-- scans this table to enforce the cascade -- the same finding 0004 fixed for
-- the tables added in 0002.
create index if not exists post_captions_post_id_idx on public.post_captions (post_id);
create index if not exists post_captions_user_id_idx on public.post_captions (user_id);

alter table public.post_captions enable row level security;

-- Readable by everyone: the feed and the post page both work logged out.
drop policy if exists post_captions_select_all on public.post_captions;
create policy post_captions_select_all on public.post_captions
    for select using (true);

-- Writes are the post owner's only. `(select auth.uid())` rather than a bare
-- auth.uid() so Postgres evaluates it once per statement, per 0004.
-- The posts subquery stops a signed-in user attaching a track to someone
-- else's video by passing their own id as user_id.
drop policy if exists post_captions_insert_own on public.post_captions;
create policy post_captions_insert_own on public.post_captions
    for insert with check (
        (select auth.uid()) = user_id
        and exists (
            select 1 from public.posts p
            where p.id = post_id and p.user_id = (select auth.uid())
        )
    );

drop policy if exists post_captions_update_own on public.post_captions;
create policy post_captions_update_own on public.post_captions
    for update using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists post_captions_delete_own on public.post_captions;
create policy post_captions_delete_own on public.post_captions
    for delete using ((select auth.uid()) = user_id);

-- Make the new table visible to the REST API immediately.
notify pgrst, 'reload schema';
