-- Two findings from the Supabase performance linter after 0002/0003.
-- Run after 0003_feed_rpcs.sql. Idempotent -- safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. RLS initplan.
--
-- 0001_init.sql generated its write policies with a bare `auth.uid()`, which
-- Postgres re-evaluates once PER ROW. Wrapping it as `(select auth.uid())`
-- makes it an InitPlan evaluated once per statement instead. The new tables in
-- 0002 already do this; these are the seven original tables.
--
-- The select policies are NOT regenerated here: posts and comments carry the
-- soft-delete predicate added in 0002, and blindly recreating them as
-- `using (true)` would expose deleted content again.
-- ---------------------------------------------------------------------------

do $$
declare
    t text;
begin
    foreach t in array array['profiles', 'posts', 'comments', 'likes',
                             'follows', 'saves', 'reposts']
    loop
        execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
        execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
        execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);

        execute format(
            'create policy "%s_insert_own" on public.%I for insert '
            'with check ((select auth.uid()) = user_id)', t, t);
        execute format(
            'create policy "%s_update_own" on public.%I for update '
            'using ((select auth.uid()) = user_id) '
            'with check ((select auth.uid()) = user_id)', t, t);
        execute format(
            'create policy "%s_delete_own" on public.%I for delete '
            'using ((select auth.uid()) = user_id)', t, t);
    end loop;
end;
$$;

-- The two select policies, restated so this file is self-contained and cannot
-- silently drift from 0002.
drop policy if exists posts_select_all on public.posts;
create policy posts_select_all on public.posts
    for select using (deleted_at is null or (select auth.uid()) = user_id);

drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments
    for select using (deleted_at is null or (select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. Covering indexes for the new foreign keys.
--
-- Without these, deleting a post or a user makes Postgres sequentially scan
-- every referencing table to enforce ON DELETE CASCADE -- which is exactly
-- what the soft delete in useDeletePostById was meant to avoid paying for.
-- ---------------------------------------------------------------------------

create index if not exists notifications_actor_idx     on public.notifications (actor_id);
create index if not exists notifications_post_idx      on public.notifications (post_id);
create index if not exists notifications_comment_idx   on public.notifications (comment_id);
create index if not exists feed_seen_post_idx          on public.feed_seen (post_id);
create index if not exists feed_seen_user_idx          on public.feed_seen (user_id);
create index if not exists mutes_muted_idx             on public.mutes (muted_id);
create index if not exists post_not_interested_post_idx on public.post_not_interested (post_id);
create index if not exists reports_target_post_idx     on public.reports (target_post_id);
create index if not exists reports_target_user_idx     on public.reports (target_user_id);
create index if not exists reports_target_comment_idx  on public.reports (target_comment_id);
create index if not exists user_creator_affinity_creator_idx
    on public.user_creator_affinity (creator_id);
create index if not exists user_topic_affinity_hashtag_idx
    on public.user_topic_affinity (hashtag_id);

notify pgrst, 'reload schema';
