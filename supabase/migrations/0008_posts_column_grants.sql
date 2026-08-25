-- Column-level INSERT grants for public.posts. Run after 0007. Idempotent --
-- safe to re-run.
--
-- 0006 section 2 closed the UPDATE half of this for posts and profiles: a user
-- could PATCH their own posts.like_count / view_count / share_count, which are
-- direct inputs to feed_rank_score(), so it was feed manipulation rather than a
-- cosmetic number. It did not close the INSERT half, for either table. The
-- counters are just as settable one statement earlier -- "publish a video that
-- arrives with 900 likes" is the same attack with the same effect on ranking,
-- and it needs no second request.
--
-- 0007 section 3 made that argument for comments and fixed both halves there.
-- This file is the same fix for posts, and it is deliberately the whole grant
-- rather than only the missing INSERT: 0007 restates grants it did not
-- originate for exactly this reason, and it means a database where 0006 never
-- ran still ends up correct. Re-running 0006 afterwards is a no-op.
--
-- RLS is not an alternative. posts_insert_own / posts_update_own restrict WHICH
-- ROWS a user may write; only a column grant restricts WHICH COLUMNS.
--
-- profiles is NOT covered here. It has the same open INSERT (follower_count,
-- following_count, post_count) and needs the same treatment, but the client
-- never inserts a profile at all -- handle_new_user does -- so the column list
-- is a different question and belongs in its own file with its own reasoning.
--
-- service_role is deliberately untouched, as in 0006: scripts/media/* and
-- scripts/seed/* use it and are expected to bypass all of this.

-- Same discipline as 0007 section 0: fail fast rather than queue in front of
-- readers, since this file is idempotent and a timeout only means "retry".
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. INSERT.
--
-- Exactly the seven columns useCreatePost sends. An INSERT needs privilege on
-- the columns it NAMES, so every column left out of this list keeps its default
-- and becomes unforgeable from the client:
--
--   id                     gen_random_uuid(); nothing needs the client to pick it.
--   created_at             recency is the other half of feed_rank_score(). A
--                          client that can set it can backdate or post-date its
--                          way up the feed without touching a counter at all.
--   updated_at             maintained by the posts_updated_at trigger from 0002.
--   like_count .. view_count
--                          the six counters this file exists for. Every writer
--                          that legitimately moves them (bump_post_counter,
--                          record_watch, record_share, reconcile_counters) is
--                          SECURITY DEFINER and so unaffected.
--   deleted_at             a post that arrives already deleted is not a thing
--                          the product does; the soft delete is an UPDATE.
--   media_kind             derived from video_url by its own column default.
-- ---------------------------------------------------------------------------

revoke insert on public.posts from anon, authenticated;
grant  insert (user_id, text, video_url, poster_key, duration_ms, width, height)
    on public.posts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. UPDATE, restated from 0006 section 2.
--
-- Unchanged in effect where 0006 has already run. Where it has not, this is the
-- statement that actually closes the counter hole, and leaving it to 0006 would
-- mean this file hardens the INSERT path while the UPDATE path beside it stays
-- open -- a strictly worse outcome than either file alone intends.
--
-- deleted_at is the soft delete in useDeletePostById. text is the caption edit.
-- Nothing else is editable, which is why re-parenting, re-pointing media, or
-- moving a post between authors are all impossible from the client.
-- ---------------------------------------------------------------------------

revoke update on public.posts from anon, authenticated;
grant  update (text, deleted_at) on public.posts to authenticated;

reset lock_timeout;

-- PostgREST builds its schema cache from information_schema, privileges
-- included, so it has to be told or it will keep advertising the columns it
-- could write a moment ago.
notify pgrst, 'reload schema';
