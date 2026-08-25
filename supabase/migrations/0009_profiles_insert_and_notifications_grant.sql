-- The two grants 0006 and 0008 left behind. Run after 0008. Idempotent --
-- safe to re-run.
--
-- Both are the same species of bug as the ones those files fixed: a privilege
-- that is wide not because anyone decided it should be, but because nothing
-- ever narrowed it. Neither is reachable by the app, which is exactly why they
-- survived this long -- nothing breaks while they sit open.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. profiles: INSERT.
--
-- 0006 section 2 revoked UPDATE on profiles and granted back (name, bio,
-- image). It left INSERT untouched, so follower_count, following_count and
-- post_count -- follower_count being a direct input to get_trending_creators,
-- and all three being what a profile page reports -- remained settable by any
-- signed-in user, on one row: their own.
--
-- profiles_insert_own caps the damage at that one row, which is why this is a
-- smaller hole than the posts one 0008 closed. It is still a hole: an account
-- can be created and then hand itself any follower count it likes.
--
-- No column grant to replace it, unlike posts. Nothing in the app inserts a
-- profile -- handle_new_user does, on the auth.users trigger, and it is
-- SECURITY DEFINER owned by postgres, so revoking from authenticated cannot
-- reach it. scripts/seed creates accounts through auth.admin.createUser and
-- lets the same trigger do the insert. This is 0007's argument about
-- comment_likes UPDATE applied one table over: where there is no legitimate
-- caller, leaving the privilege ungranted removes the surface instead of
-- policing it.
--
-- profiles_insert_own is deliberately left in place. It is unreachable once the
-- grant is gone, but it costs nothing and it is the thing that still holds if a
-- future migration grants INSERT back without thinking it through.
-- ---------------------------------------------------------------------------

revoke insert on public.profiles from anon, authenticated;

-- Restated from 0006 section 2, for the reason 0008 gives: a file that changes
-- one half of a table's grant should leave the other half stated, not assumed.
revoke update on public.profiles from anon, authenticated;
grant  update (name, bio, image) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_notifications: EXECUTE.
--
-- 0006 section 3 replaced this function by DROPping it and creating the 3-arg
-- version -- necessary, because adding a parameter would otherwise create an
-- overload PostgREST cannot resolve. But DROP takes the ACL with it, and the
-- CREATE that follows gets Postgres's default of EXECUTE to PUBLIC. The
-- 2-arg function it replaced was authenticated-only, so the replacement was
-- strictly looser than the thing it replaced.
--
-- Not a leak: the body returns immediately when auth.uid() is null, so an
-- anonymous call gets an empty list rather than somebody else's activity. This
-- is about the function no longer being an anonymous endpoint at all, and about
-- matching its five siblings -- get_unread_notification_count,
-- mark_notifications_read, get_following_feed, get_blocked_accounts,
-- get_muted_accounts -- every one of which is postgres/authenticated/
-- service_role and nothing else.
--
-- The signature is spelled out because the 2-arg version may still exist on a
-- database where 0006 has not run; naming the argument types means this
-- statement either finds the 3-arg function or fails loudly, rather than
-- silently adjusting the wrong one.
-- ---------------------------------------------------------------------------

revoke execute on function public.get_notifications(jsonb, integer, text) from public, anon;
grant  execute on function public.get_notifications(jsonb, integer, text) to authenticated;

reset lock_timeout;

-- Privileges are part of what PostgREST caches, so it has to be told.
notify pgrst, 'reload schema';
