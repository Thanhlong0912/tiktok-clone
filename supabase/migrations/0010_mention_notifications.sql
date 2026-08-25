-- Mention notifications. Run after 0009. Idempotent -- safe to re-run.
--
-- 'mention' has been in the notifications type CHECK since 0002, in
-- get_notifications' validation list since 0006, and in the Activity renderer
-- (FaAt, "mentioned you") since it was written. Nothing has ever inserted one.
-- The type was dead end to end: a caption could say @someone, the client would
-- linkify it to their profile, and they would never hear about it.
--
-- Two surfaces, because both already render mentions as links: post captions,
-- and comment bodies since 0007 unified them onto CommentThread.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. mention_key: the same normalizer the client uses.
--
-- Must stay behaviourally identical to mentionKey() in app/utils/mentionKey.ts
-- -- app/utils/mentions.test.ts pins the shared fixture, exactly as
-- postTags.test.ts does for normalize_tag. They diverge silently otherwise,
-- and the failure mode is invisible rather than loud: the client would linkify
-- @Name to a profile while this resolved the same token to nobody, so the
-- mention would look live and notify no one -- the bug this file exists to fix.
--
-- This is NOT normalize_tag, deliberately. A hashtag strips punctuation
-- because a tag is a slug; a mention has to match a display name character for
-- character, and @O'Brien and @OBrien are two different people.
--
-- No SET search_path clause, unlike every other function here, and everything
-- is schema-qualified instead: this is used in an index expression below, and
-- pinning the path the usual way is worth avoiding where a planner has to
-- reason about the expression. Nothing is reachable through it regardless --
-- it takes text and returns text and touches no table.
--
-- Grants are left at the default, matching normalize_tag: a pure string
-- function with no data access, which the expression index also needs usable.
-- ---------------------------------------------------------------------------

create or replace function public.mention_key(p_name text)
returns text
language sql
immutable
strict
parallel safe
as $$
    select pg_catalog.lower(pg_catalog.regexp_replace(p_name, '[\s@]+', '', 'g'));
$$;

-- profiles_name_idx from 0001 is a btree on lower(name), which cannot serve
-- this predicate -- the expressions differ by the space stripping.
create index if not exists profiles_mention_key_idx
    on public.profiles (public.mention_key(name));

-- ---------------------------------------------------------------------------
-- 2. Two functions, not one.
--
-- 0002's rule above notify_post_author applies unchanged: plpgsql resolves
-- every field reference when it compiles a statement, even on a branch that
-- cannot be reached, so one shared function naming new.parent_id would fail on
-- public.posts with `record "new" has no field "parent_id"`.
--
-- The token grammar is '@([^\s#@]+)', which is TOKEN_SPLIT_REGEX from
-- app/components/CaptionText.tsx spelled for Postgres. It is matched anywhere
-- in the text rather than only after whitespace, quirk included: the client
-- linkifies the @gmail.com in an email address too, and a resolver that
-- disagreed with the renderer would be the same silent divergence mention_key
-- is guarded against. It resolves to nobody in practice.
--
-- Cap of 10 distinct mentions per text, for the reason sync_post_hashtags caps
-- tags: one caption should not be able to fan out unbounded writes.
--
-- Ambiguity resolves to nobody. profiles.name is not unique, so a key can
-- match several accounts; the count(*) = 1 guard drops those. Notifying all of
-- them would tell people about a stranger's post, and picking one would
-- sometimes pick the wrong person. Unique handles are the real fix and are a
-- much larger change.
--
-- Blocks are not filtered here. get_notifications already excludes rows whose
-- actor the reader has blocked, which is where every other notification type
-- is filtered too.
--
-- ON CONFLICT DO NOTHING, unlike notify_comment_author's DO UPDATE. That one
-- aggregates because each new comment is a new event worth resurfacing. This
-- trigger re-runs on every caption edit, so DO UPDATE would clear read_at and
-- bump created_at every time an author fixed a typo. DO NOTHING means: the
-- first time you are mentioned on a post, you hear about it, once.
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
    join public.profiles pr on public.mention_key(pr.name) = t.key
    where pr.user_id <> new.user_id
      and (select count(*) from public.profiles amb
            where public.mention_key(amb.name) = t.key) = 1
    on conflict (user_id, actor_id, type,
                 coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do nothing;

    return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The comment half, plus the suppression rule.
--
-- A reply saying "@you thanks" would otherwise arrive twice: once as the
-- 'comment' notification 0007's reply branch sends, and once as a mention. One
-- action should produce one notification, so whoever notify_comment_author
-- targets is skipped here.
--
-- That target is RECOMPUTED with the identical fallback chain rather than
-- looked up by checking for an existing row. AFTER ROW triggers fire in name
-- order, and comments_mention_notify_trg sorts before comments_notify_trg, so
-- the row would not exist yet -- but more importantly a rule that depends on
-- trigger names is a rule that breaks silently when one is renamed, which 0007
-- already had to warn about for the counter triggers.
--
-- On an edit the suppression still applies even though comments_notify_trg is
-- INSERT-only and is not firing. That is the intended reading: the person
-- already has a notification pointing at this comment.
--
-- LOCK ORDER. This trigger writes only to notifications, and its name places
-- it between comments_count_trg (posts) and comments_reply_count_trg
-- (comments), alongside comments_notify_trg. The established order of
-- posts -> notifications -> comments is preserved. Keep that relationship if
-- any of these are ever renamed.
-- ---------------------------------------------------------------------------

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
    join public.profiles pr on public.mention_key(pr.name) = t.key
    where pr.user_id <> new.user_id
      and pr.user_id is distinct from v_skip
      and (select count(*) from public.profiles amb
            where public.mention_key(amb.name) = t.key) = 1
    -- comment_id is not part of the dedup key, so a second mention of the same
    -- person by the same actor on the same post keeps pointing at the first
    -- comment. The post is the same either way.
    on conflict (user_id, actor_id, type,
                 coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do nothing;

    return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers.
--
-- INSERT OR UPDATE OF text on both, matching posts_sync_hashtags rather than
-- comments_notify_trg: editing a caption to add a mention should reach the
-- person added. DO NOTHING above is what keeps the edit path from re-alerting
-- everyone already mentioned.
-- ---------------------------------------------------------------------------

drop trigger if exists posts_mention_notify_trg on public.posts;
create trigger posts_mention_notify_trg
    after insert or update of text on public.posts
    for each row execute function public.notify_post_mentions();

drop trigger if exists comments_mention_notify_trg on public.comments;
create trigger comments_mention_notify_trg
    after insert or update of text on public.comments
    for each row execute function public.notify_comment_mentions();

reset lock_timeout;

-- Trigger-only, matching every other notify_* function since 0002.
revoke execute on function public.notify_post_mentions()    from public, anon, authenticated;
revoke execute on function public.notify_comment_mentions() from public, anon, authenticated;

notify pgrst, 'reload schema';
