-- Feed, discovery, signal-recording and moderation RPCs.
-- Run after 0002_feed_and_signals.sql. Idempotent -- safe to re-run.
--
-- The app has no server tier (no API routes, no server actions, no
-- middleware), so these SECURITY DEFINER functions ARE the server. Two rules
-- follow from that and must hold on every future edit:
--
--   1. Definer functions bypass RLS. The `deleted_at is null` and block/mute
--      predicates below are the ONLY thing standing in for it. Losing one
--      silently exposes removed or blocked content.
--   2. Every writer derives the actor from (select auth.uid()), NEVER from an
--      argument. A caller must not be able to write rows on behalf of someone
--      else, or inflate another creator's counters.

-- ---------------------------------------------------------------------------
-- Shared row shape.
--
-- Dropped with CASCADE so the file is re-runnable: that drops every function
-- returning it, all of which are recreated below. Postgres will not replace a
-- function whose return type changed, so this is also what keeps
-- `create or replace` from failing on the second run.
-- ---------------------------------------------------------------------------

drop type if exists public.feed_post cascade;
create type public.feed_post as (
    id            uuid,
    user_id       uuid,
    video_url     text,
    poster_key    text,
    media_kind    text,
    text          text,
    duration_ms   integer,
    width         integer,
    height        integer,
    created_at    timestamptz,
    like_count    integer,
    comment_count integer,
    save_count    integer,
    repost_count  integer,
    share_count   integer,
    view_count    integer,
    profile_name  text,
    profile_image text,
    is_liked      boolean,
    is_saved      boolean,
    is_reposted   boolean,
    is_following  boolean,
    score         numeric
);

-- ---------------------------------------------------------------------------
-- Ranking. This is the ML seam: when post_scores.ml_score is non-null it is
-- returned verbatim, so shipping a model means writing a column rather than
-- changing a single call site.
-- ---------------------------------------------------------------------------

create or replace function public.feed_rank_score(
    p_like_count       integer,
    p_comment_count    integer,
    p_save_count       integer,
    p_repost_count     integer,
    p_share_count      integer,
    p_view_count       integer,
    p_avg_completion   real,
    p_avg_watch_ms     integer,
    p_skip_rate        real,
    p_age_hours        double precision,
    p_creator_affinity real,
    p_tag_affinity     real,
    p_is_following     boolean,
    p_neg_creator      boolean,
    p_neg_tag          real,
    p_ml_score         real default null
) returns double precision
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
    select case when p_ml_score is not null then p_ml_score::double precision else
        (
            (
              -- Bayesian-smoothed engagement rates. The +40 pseudo-views stop a
              -- 1-view/1-like post from outranking a 10k-view hit.
                6.0  * ((p_like_count    + 1.0 ) / (p_view_count + 40.0))
              + 9.0  * ((p_comment_count + 0.4 ) / (p_view_count + 40.0))
              + 8.0  * ((p_save_count    + 0.3 ) / (p_view_count + 40.0))
              + 10.0 * ((p_repost_count  + 0.2 ) / (p_view_count + 40.0))
              + 7.0  * ((p_share_count   + 0.2 ) / (p_view_count + 40.0))
              -- Watch signals dominate: this is what makes it a video feed
              -- rather than a like-ranked feed.
              + 14.0 * least(coalesce(p_avg_completion, 0.0), 2.0)
              + 4.0  * least(coalesce(p_avg_watch_ms, 0) / 15000.0, 1.5)
              -- Personalisation.
              + 5.0  * least(greatest(coalesce(p_creator_affinity, 0.0), -3.0), 3.0)
              + 4.0  * least(greatest(coalesce(p_tag_affinity, 0.0), -3.0), 3.0)
              + case when p_is_following then 3.0 else 0.0 end
            )
            * exp(-0.045 * greatest(coalesce(p_age_hours, 0.0), 0.0))   -- ~15h half-life
        )
        -- Exploration: guarantees every new upload gets impressions.
        + case when coalesce(p_age_hours, 999) < 6 then 1.5 else 0.0 end
        -- Penalties applied AFTER decay so they do not fade with age.
        - 8.0 * coalesce(p_skip_rate, 0.0)
        - case when p_neg_creator then 6.0 else 0.0 end
        - 3.0 * greatest(-coalesce(p_neg_tag, 0.0), 0.0)
    end;
$$;

-- ---------------------------------------------------------------------------
-- Batch score refresh. quality_score bakes in freshness decay and therefore
-- goes stale between runs -- fine, because it only drives CANDIDATE selection;
-- get_feed recomputes decay against now() for the final ordering.
-- ---------------------------------------------------------------------------

create or replace function public.refresh_post_scores(p_since interval default '15 minutes')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
    with touched as (
        select post_id from public.post_views where updated_at > now() - p_since
        union
        select id from public.posts
         where created_at > now() - p_since or updated_at > now() - p_since
    ),
    agg as (
        select t.post_id,
               count(v.user_id)::int                                         as viewer_count,
               coalesce(avg(v.max_completion), 0)::real                       as avg_completion,
               coalesce(avg(v.watch_ms), 0)::int                              as avg_watch_ms,
               coalesce(avg(case when v.skipped then 1 else 0 end), 0)::real  as skip_rate
        from touched t
        left join public.post_views v on v.post_id = t.post_id
        group by t.post_id
    )
    insert into public.post_scores
        (post_id, viewer_count, avg_completion, avg_watch_ms, skip_rate, quality_score, computed_at)
    select a.post_id, a.viewer_count, a.avg_completion, a.avg_watch_ms, a.skip_rate,
           public.feed_rank_score(
               p.like_count, p.comment_count, p.save_count, p.repost_count,
               p.share_count, p.view_count,
               a.avg_completion, a.avg_watch_ms, a.skip_rate,
               extract(epoch from (now() - p.created_at)) / 3600.0,
               0, 0, false, false, 0,   -- no viewer: this is global quality only
               null),
           now()
    from agg a
    join public.posts p on p.id = a.post_id and p.deleted_at is null
    on conflict (post_id) do update set
        viewer_count   = excluded.viewer_count,
        avg_completion = excluded.avg_completion,
        avg_watch_ms   = excluded.avg_watch_ms,
        skip_rate      = excluded.skip_rate,
        quality_score  = excluded.quality_score,
        computed_at    = excluded.computed_at;

    get diagnostics v_n = row_count;
    return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- The For You feed. One call replaces ~900 HTTP round-trips.
--
-- Stage 1 gathers ~400 candidates from four capped, index-only sources.
-- Stage 2 does the personalised arithmetic over just those rows. Nothing
-- ever scans public.posts.
-- ---------------------------------------------------------------------------

create or replace function public.get_feed(
    p_cursor  jsonb   default null,
    p_limit   integer default 10,
    p_session uuid    default null
)
returns setof public.feed_post
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid     uuid    := (select auth.uid());
    v_limit   integer := least(greatest(coalesce(p_limit, 10), 1), 30);
    v_session uuid    := coalesce(p_session, nullif(p_cursor->>'s', '')::uuid, gen_random_uuid());
    v_score   numeric := nullif(p_cursor->>'sc', '')::numeric;
    v_id      uuid    := nullif(p_cursor->>'id', '')::uuid;
begin
    return query
    with hidden as (
        select blocked_id as uid from public.blocks where blocker_id = v_uid
        union
        select blocker_id      from public.blocks where blocked_id = v_uid
        union
        select muted_id        from public.mutes  where muter_id  = v_uid
    ),
    seen as (
        select post_id from public.feed_seen where session_id = v_session
        union
        -- Permanent exclusion: they actually watched it, not just got served it.
        select post_id from public.post_views
         where user_id = v_uid and (watch_ms > 2000 or max_completion >= 0.4)
        union
        select post_id from public.post_not_interested where user_id = v_uid
    ),
    candidates as (
        (select p.id from public.posts p
          where p.deleted_at is null
          order by p.created_at desc limit 150)
        union
        (select ps.post_id from public.post_scores ps
           join public.posts p on p.id = ps.post_id and p.deleted_at is null
          order by ps.quality_score desc limit 150)
        union
        (select p.id from public.posts p
           join public.follows f on f.to_user_id = p.user_id and f.user_id = v_uid
          where p.deleted_at is null
          order by p.created_at desc limit 100)
        union
        (select ph.post_id from public.post_hashtags ph
           join public.user_topic_affinity ta
             on ta.hashtag_id = ph.hashtag_id and ta.user_id = v_uid and ta.score > 0
          order by ta.score desc, ph.created_at desc limit 100)
    ),
    scored as (
        select
            p.id, p.user_id, p.video_url, p.poster_key, p.media_kind, p.text,
            p.duration_ms, p.width, p.height, p.created_at,
            p.like_count, p.comment_count, p.save_count, p.repost_count,
            p.share_count, p.view_count,
            pr.name  as profile_name,
            pr.image as profile_image,
            (l.user_id is not null) as is_liked,
            (s.user_id is not null) as is_saved,
            (r.user_id is not null) as is_reposted,
            (f.user_id is not null) as is_following,
            -- round(...,9) makes the score exactly round-trippable through
            -- JSON, so the cursor comparison below is byte-exact.
            round(public.feed_rank_score(
                p.like_count, p.comment_count, p.save_count, p.repost_count,
                p.share_count, p.view_count,
                sc.avg_completion, sc.avg_watch_ms, sc.skip_rate,
                extract(epoch from (now() - p.created_at)) / 3600.0,
                ca.score, ta.tag_affinity,
                (f.user_id is not null),
                coalesce(ca.score, 0) < -0.5,
                ta.tag_affinity,
                sc.ml_score
            )::numeric, 9) as score
        from candidates c
        join public.posts    p  on p.id = c.id and p.deleted_at is null
        join public.profiles pr on pr.user_id = p.user_id
        left join public.post_scores sc on sc.post_id = p.id
        left join public.likes   l on l.post_id = p.id and l.user_id = v_uid
        left join public.saves   s on s.post_id = p.id and s.user_id = v_uid
        left join public.reposts r on r.post_id = p.id and r.user_id = v_uid
        left join public.follows f on f.to_user_id = p.user_id and f.user_id = v_uid
        left join public.user_creator_affinity ca
               on ca.creator_id = p.user_id and ca.user_id = v_uid
        left join lateral (
            select coalesce(sum(t.score), 0)::real as tag_affinity
            from public.post_hashtags ph
            join public.user_topic_affinity t
              on t.hashtag_id = ph.hashtag_id and t.user_id = v_uid
            where ph.post_id = p.id
        ) ta on true
        where not exists (select 1 from seen  x where x.post_id = p.id)
          and not exists (select 1 from hidden h where h.uid = p.user_id)
          and (v_uid is null or p.user_id <> v_uid)
    ),
    -- At most 2 posts from the same creator per page.
    diversified as (
        select *, row_number() over (partition by user_id order by score desc, id desc) as rn
        from scored
    ),
    page as (
        select * from diversified
        where rn <= 2
          and (v_score is null or (score, id) < (v_score, v_id))
        order by score desc, id desc
        limit v_limit
    ),
    -- Data-modifying CTE: Postgres runs it exactly once, to completion,
    -- in the same statement that selects the page. This is what makes the
    -- pagination exact rather than best-effort.
    remember as (
        insert into public.feed_seen (session_id, post_id, user_id)
        select v_session, page.id, v_uid from page
        on conflict do nothing
        returning 1
    )
    select page.id, page.user_id, page.video_url, page.poster_key, page.media_kind,
           page.text, page.duration_ms, page.width, page.height, page.created_at,
           page.like_count, page.comment_count, page.save_count, page.repost_count,
           page.share_count, page.view_count,
           page.profile_name, page.profile_image,
           page.is_liked, page.is_saved, page.is_reposted, page.is_following,
           page.score
    from page
    order by page.score desc, page.id desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Following feed. Chronological, so a plain (created_at, id) keyset is exact
-- and needs no session table. Replaces the useGetFollowing + client-side
-- .filter() in app/page.tsx, which could only ever see the newest 100 posts
-- globally and so silently dropped followed creators.
-- ---------------------------------------------------------------------------

create or replace function public.get_following_feed(
    p_cursor jsonb   default null,
    p_limit  integer default 10
)
returns setof public.feed_post
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid   uuid        := (select auth.uid());
    v_limit integer     := least(greatest(coalesce(p_limit, 10), 1), 30);
    v_ts    timestamptz := nullif(p_cursor->>'ts', '')::timestamptz;
    v_id    uuid        := nullif(p_cursor->>'id', '')::uuid;
begin
    if v_uid is null then
        return;
    end if;

    return query
    select p.id, p.user_id, p.video_url, p.poster_key, p.media_kind, p.text,
           p.duration_ms, p.width, p.height, p.created_at,
           p.like_count, p.comment_count, p.save_count, p.repost_count,
           p.share_count, p.view_count,
           pr.name, pr.image,
           (l.user_id is not null), (s.user_id is not null),
           (r.user_id is not null), true,
           0::numeric
    from public.posts p
    join public.follows  f  on f.to_user_id = p.user_id and f.user_id = v_uid
    join public.profiles pr on pr.user_id = p.user_id
    left join public.likes   l on l.post_id = p.id and l.user_id = v_uid
    left join public.saves   s on s.post_id = p.id and s.user_id = v_uid
    left join public.reposts r on r.post_id = p.id and r.user_id = v_uid
    where p.deleted_at is null
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = v_uid and b.blocked_id = p.user_id)
                          or (b.blocked_id = v_uid and b.blocker_id = p.user_id))
      and (v_ts is null or (p.created_at, p.id) < (v_ts, v_id))
    order by p.created_at desc, p.id desc
    limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Single post (detail page)
-- ---------------------------------------------------------------------------

create or replace function public.get_post(p_post_id uuid)
returns setof public.feed_post
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.id, p.user_id, p.video_url, p.poster_key, p.media_kind, p.text,
           p.duration_ms, p.width, p.height, p.created_at,
           p.like_count, p.comment_count, p.save_count, p.repost_count,
           p.share_count, p.view_count,
           pr.name, pr.image,
           exists (select 1 from public.likes   l where l.post_id = p.id and l.user_id = (select auth.uid())),
           exists (select 1 from public.saves   s where s.post_id = p.id and s.user_id = (select auth.uid())),
           exists (select 1 from public.reposts r where r.post_id = p.id and r.user_id = (select auth.uid())),
           exists (select 1 from public.follows f where f.to_user_id = p.user_id and f.user_id = (select auth.uid())),
           0::numeric
    from public.posts p
    join public.profiles pr on pr.user_id = p.user_id
    where p.id = p_post_id
      and (p.deleted_at is null or p.user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Profile tabs. p_tab in ('posts','liked','saved','reposts').
-- 'saved' is owner-only and enforced HERE, not in the UI -- the previous
-- implementation hid the tab client-side while the rows stayed world-readable.
-- ---------------------------------------------------------------------------

create or replace function public.get_user_posts(
    p_user_id uuid,
    p_tab     text    default 'posts',
    p_cursor  jsonb   default null,
    p_limit   integer default 24
)
returns setof public.feed_post
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid   uuid        := (select auth.uid());
    v_limit integer     := least(greatest(coalesce(p_limit, 24), 1), 48);
    v_ts    timestamptz := nullif(p_cursor->>'ts', '')::timestamptz;
    v_id    uuid        := nullif(p_cursor->>'id', '')::uuid;
    v_tab   text        := coalesce(p_tab, 'posts');
begin
    if v_tab not in ('posts', 'liked', 'saved', 'reposts') then
        raise exception 'unknown tab %', v_tab using errcode = '22023';
    end if;

    -- Saved is private to its owner.
    if v_tab = 'saved' and (v_uid is null or v_uid <> p_user_id) then
        return;
    end if;

    return query
    with source as (
        select p.id, p.created_at as sort_at
        from public.posts p
        where v_tab = 'posts' and p.user_id = p_user_id and p.deleted_at is null
        union all
        select l.post_id, l.created_at
        from public.likes l where v_tab = 'liked' and l.user_id = p_user_id
        union all
        select s.post_id, s.created_at
        from public.saves s where v_tab = 'saved' and s.user_id = p_user_id
        union all
        select r.post_id, r.created_at
        from public.reposts r where v_tab = 'reposts' and r.user_id = p_user_id
    )
    select p.id, p.user_id, p.video_url, p.poster_key, p.media_kind, p.text,
           p.duration_ms, p.width, p.height, p.created_at,
           p.like_count, p.comment_count, p.save_count, p.repost_count,
           p.share_count, p.view_count,
           pr.name, pr.image,
           (l.user_id is not null), (sv.user_id is not null),
           (rp.user_id is not null), (fl.user_id is not null),
           0::numeric
    from source src
    join public.posts    p  on p.id = src.id and p.deleted_at is null
    join public.profiles pr on pr.user_id = p.user_id
    left join public.likes   l  on l.post_id  = p.id and l.user_id  = v_uid
    left join public.saves   sv on sv.post_id = p.id and sv.user_id = v_uid
    left join public.reposts rp on rp.post_id = p.id and rp.user_id = v_uid
    left join public.follows fl on fl.to_user_id = p.user_id and fl.user_id = v_uid
    where not exists (select 1 from public.blocks b
                       where (b.blocker_id = v_uid and b.blocked_id = p.user_id)
                          or (b.blocked_id = v_uid and b.blocker_id = p.user_id))
      and (v_ts is null or (src.sort_at, p.id) < (v_ts, v_id))
    order by src.sort_at desc, p.id desc
    limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile header: replaces four separate round-trips (profile, followers,
-- following, plus one likes query PER POST to sum the like total).
-- ---------------------------------------------------------------------------

create or replace function public.get_profile(p_user_id uuid)
returns table (
    user_id         uuid,
    name            text,
    image           text,
    bio             text,
    follower_count  integer,
    following_count integer,
    post_count      integer,
    total_likes     bigint,
    is_following    boolean,
    is_blocked      boolean,
    is_self         boolean
)
language sql
stable
security definer
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
           pr.user_id = (select auth.uid())
    from public.profiles pr
    where pr.user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- Batched engagement read, for grids that already have their post ids.
-- The [1:200] slice is a hard cap that costs nothing and stops a caller
-- passing 100k ids.
-- ---------------------------------------------------------------------------

create or replace function public.get_post_engagement(p_post_ids uuid[])
returns table (
    post_id       uuid,
    like_count    integer,
    comment_count integer,
    save_count    integer,
    repost_count  integer,
    share_count   integer,
    view_count    integer,
    is_liked      boolean,
    is_saved      boolean,
    is_reposted   boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.id, p.like_count, p.comment_count, p.save_count, p.repost_count,
           p.share_count, p.view_count,
           exists (select 1 from public.likes   l where l.post_id = p.id and l.user_id = (select auth.uid())),
           exists (select 1 from public.saves   s where s.post_id = p.id and s.user_id = (select auth.uid())),
           exists (select 1 from public.reposts r where r.post_id = p.id and r.user_id = (select auth.uid()))
    from public.posts p
    where p.id = any(p_post_ids[1:200])
      and p.deleted_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Trending
-- ---------------------------------------------------------------------------

create or replace function public.get_trending_hashtags(
    p_limit  integer  default 20,
    p_window interval default '7 days'
)
returns table (tag text, post_count bigint, recent_count bigint, engagement bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select h.tag,
           h.post_count::bigint,
           count(*)::bigint,
           coalesce(sum(p.like_count + p.comment_count * 2 + p.repost_count * 3), 0)::bigint
    from public.post_hashtags ph
    join public.hashtags h on h.id = ph.hashtag_id
    join public.posts    p on p.id = ph.post_id
    where ph.created_at > now() - p_window
      and p.deleted_at is null
    group by h.tag, h.post_count
    order by 4 desc, 3 desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Aggregates over every post per profile. Fine at this scale; this is the
-- first query that will want a materialized view. Swap one in behind the same
-- signature when it measurably slows down -- the call site never changes.
create or replace function public.get_trending_creators(p_limit integer default 10)
returns table (
    user_id           uuid,
    name              text,
    image             text,
    bio               text,
    follower_count    integer,
    post_count        integer,
    recent_engagement bigint,
    is_following      boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count, pr.post_count,
           coalesce(sum(p.like_count + p.comment_count * 2 + p.repost_count * 3)
                    filter (where p.created_at > now() - interval '14 days'), 0)::bigint,
           exists (select 1 from public.follows f
                    where f.user_id = (select auth.uid()) and f.to_user_id = pr.user_id)
    from public.profiles pr
    left join public.posts p on p.user_id = pr.user_id and p.deleted_at is null
    where pr.user_id is distinct from (select auth.uid())
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = pr.user_id))
    group by pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count, pr.post_count
    order by 7 desc, pr.follower_count desc
    limit least(greatest(coalesce(p_limit, 10), 1), 30);
$$;

-- ---------------------------------------------------------------------------
-- Search. Query text is always a bound PARAMETER inside ilike, never
-- concatenated into SQL, so there is no injection surface. A %-heavy query is
-- a performance problem, not a security one -- length is capped client-side.
-- ---------------------------------------------------------------------------

create or replace function public.search_users(p_query text, p_limit integer default 12)
returns table (
    user_id        uuid,
    name           text,
    image          text,
    bio            text,
    follower_count integer,
    is_following   boolean,
    rank           real
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count,
           exists (select 1 from public.follows f
                    where f.user_id = (select auth.uid()) and f.to_user_id = pr.user_id),
           extensions.similarity(pr.name, p_query)
    from public.profiles pr
    where pr.name ilike '%' || p_query || '%'
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = pr.user_id))
    order by extensions.similarity(pr.name, p_query) desc, pr.follower_count desc
    limit least(greatest(coalesce(p_limit, 12), 1), 30);
$$;

create or replace function public.search_hashtags(p_query text, p_limit integer default 8)
returns table (tag text, post_count integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select h.tag, h.post_count
    from public.hashtags h
    where h.tag like public.normalize_tag(p_query) || '%'
       or h.tag like '%' || public.normalize_tag(p_query) || '%'
    order by (h.tag like public.normalize_tag(p_query) || '%') desc, h.post_count desc
    limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

create or replace function public.search_videos(
    p_query  text,
    p_cursor jsonb   default null,
    p_limit  integer default 24
)
returns setof public.feed_post
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid   uuid    := (select auth.uid());
    v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 48);
    v_rank  numeric := nullif(p_cursor->>'sc', '')::numeric;
    v_id    uuid    := nullif(p_cursor->>'id', '')::uuid;
begin
    return query
    select p.id, p.user_id, p.video_url, p.poster_key, p.media_kind, p.text,
           p.duration_ms, p.width, p.height, p.created_at,
           p.like_count, p.comment_count, p.save_count, p.repost_count,
           p.share_count, p.view_count,
           pr.name, pr.image,
           (l.user_id is not null), (s.user_id is not null),
           (r.user_id is not null), (f.user_id is not null),
           (p.like_count + p.comment_count * 2 + p.repost_count * 3)::numeric
    from public.posts p
    join public.profiles pr on pr.user_id = p.user_id
    left join public.likes   l on l.post_id = p.id and l.user_id = v_uid
    left join public.saves   s on s.post_id = p.id and s.user_id = v_uid
    left join public.reposts r on r.post_id = p.id and r.user_id = v_uid
    left join public.follows f on f.to_user_id = p.user_id and f.user_id = v_uid
    where p.deleted_at is null
      and (p.text ilike '%' || p_query || '%' or pr.name ilike '%' || p_query || '%')
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = v_uid and b.blocked_id = p.user_id)
                          or (b.blocked_id = v_uid and b.blocker_id = p.user_id))
      and (v_rank is null
           or ((p.like_count + p.comment_count * 2 + p.repost_count * 3)::numeric, p.id) < (v_rank, v_id))
    order by (p.like_count + p.comment_count * 2 + p.repost_count * 3) desc, p.id desc
    limit v_limit;
end;
$$;

create or replace function public.get_posts_by_hashtag(
    p_tag    text,
    p_cursor jsonb   default null,
    p_limit  integer default 24
)
returns setof public.feed_post
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid   uuid        := (select auth.uid());
    v_limit integer     := least(greatest(coalesce(p_limit, 24), 1), 48);
    v_ts    timestamptz := nullif(p_cursor->>'ts', '')::timestamptz;
    v_id    uuid        := nullif(p_cursor->>'id', '')::uuid;
    v_tag   text        := public.normalize_tag(p_tag);
begin
    return query
    select p.id, p.user_id, p.video_url, p.poster_key, p.media_kind, p.text,
           p.duration_ms, p.width, p.height, p.created_at,
           p.like_count, p.comment_count, p.save_count, p.repost_count,
           p.share_count, p.view_count,
           pr.name, pr.image,
           (l.user_id is not null), (s.user_id is not null),
           (r.user_id is not null), (f.user_id is not null),
           0::numeric
    from public.post_hashtags ph
    join public.hashtags h  on h.id = ph.hashtag_id and h.tag = v_tag
    join public.posts    p  on p.id = ph.post_id and p.deleted_at is null
    join public.profiles pr on pr.user_id = p.user_id
    left join public.likes   l on l.post_id = p.id and l.user_id = v_uid
    left join public.saves   s on s.post_id = p.id and s.user_id = v_uid
    left join public.reposts r on r.post_id = p.id and r.user_id = v_uid
    left join public.follows f on f.to_user_id = p.user_id and f.user_id = v_uid
    where not exists (select 1 from public.blocks b
                       where (b.blocker_id = v_uid and b.blocked_id = p.user_id)
                          or (b.blocked_id = v_uid and b.blocker_id = p.user_id))
      and (v_ts is null or (p.created_at, p.id) < (v_ts, v_id))
    order by p.created_at desc, p.id desc
    limit v_limit;
end;
$$;

-- The one place the typed-table pattern is broken: three heterogeneous result
-- sets in a single round trip is worth it for the Explore "Top" tab.
create or replace function public.search_top(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
        'users',    coalesce((select jsonb_agg(u) from (select * from public.search_users(p_query, 6)) u), '[]'::jsonb),
        'hashtags', coalesce((select jsonb_agg(t) from (select * from public.search_hashtags(p_query, 6)) t), '[]'::jsonb),
        'videos',   coalesce((select jsonb_agg(v) from (select * from public.search_videos(p_query, null, 12)) v), '[]'::jsonb)
    );
$$;

-- ---------------------------------------------------------------------------
-- Signal recording.
--
-- Anonymous callers are a silent no-op rather than an error, so the client can
-- fire-and-forget. Recording anon watches would be a free counter-inflation
-- vector with no accountability; logged-out users still get a feed, their
-- watches just do not train anything.
--
-- Every input is clamped. Client-reported watch time is NOT trustworthy --
-- never build anything monetary on avg_watch_ms.
-- ---------------------------------------------------------------------------

create or replace function public.record_watch(
    p_post_id    uuid,
    p_watch_ms   integer default 0,
    p_completion real    default 0,
    p_loops      integer default 0,
    p_skipped    boolean default false
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid      uuid := (select auth.uid());
    v_inserted boolean;
    v_creator  uuid;
    v_delta    real;
begin
    if v_uid is null then return; end if;

    select user_id into v_creator from public.posts
     where id = p_post_id and deleted_at is null;
    if v_creator is null then return; end if;

    insert into public.post_views
        (user_id, post_id, watch_ms, max_completion, loops, impressions, skipped)
    values
        (v_uid, p_post_id,
         least(greatest(coalesce(p_watch_ms, 0), 0), 600000),
         least(greatest(coalesce(p_completion, 0), 0), 1.0),
         least(greatest(coalesce(p_loops, 0), 0), 50),
         1,
         coalesce(p_skipped, false))
    on conflict (user_id, post_id) do update set
        watch_ms       = least(public.post_views.watch_ms
                               + least(greatest(coalesce(p_watch_ms, 0), 0), 600000), 86400000),
        max_completion = greatest(public.post_views.max_completion,
                                  least(greatest(coalesce(p_completion, 0), 0), 1.0)),
        loops          = least(public.post_views.loops
                               + least(greatest(coalesce(p_loops, 0), 0), 50), 1000),
        impressions    = least(public.post_views.impressions + 1, 10000),
        -- Stays skipped only if every pass was a skip.
        skipped        = public.post_views.skipped and coalesce(p_skipped, false),
        updated_at     = now()
    returning (xmax = 0) into v_inserted;

    -- Only a genuine first insert bumps the public counter, so replaying the
    -- same call is idempotent for view_count.
    if v_inserted then
        update public.posts set view_count = view_count + 1 where id = p_post_id;
    end if;

    -- Affinity: bounded work, and only on a meaningful watch.
    if coalesce(p_completion, 0) >= 0.5 or coalesce(p_watch_ms, 0) >= 3000 then
        v_delta := least(coalesce(p_completion, 0), 1.0) * 0.6;
    elsif coalesce(p_skipped, false) then
        v_delta := -0.35;
    else
        return;
    end if;

    if v_creator <> v_uid then
        insert into public.user_creator_affinity (user_id, creator_id, score)
        values (v_uid, v_creator, v_delta)
        on conflict (user_id, creator_id) do update
            -- 0.97 decay keeps the score bounded and lets taste drift.
            set score = least(greatest(public.user_creator_affinity.score * 0.97 + v_delta, -5), 5),
                updated_at = now();
    end if;

    insert into public.user_topic_affinity (user_id, hashtag_id, score)
    select v_uid, ph.hashtag_id, v_delta
    from public.post_hashtags ph
    where ph.post_id = p_post_id
    limit 10
    on conflict (user_id, hashtag_id) do update
        set score = least(greatest(public.user_topic_affinity.score * 0.97 + v_delta, -5), 5),
            updated_at = now();
end;
$$;

create or replace function public.record_view(p_post_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$ select public.record_watch(p_post_id, 0, 0, 0, false); $$;

create or replace function public.record_share(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid   uuid := (select auth.uid());
    v_prior boolean;
begin
    if v_uid is null then return; end if;

    -- Read the prior value first: share_count counts DISTINCT sharers, so only
    -- a user's first share may increment it.
    select shared into v_prior from public.post_views
     where user_id = v_uid and post_id = p_post_id;

    insert into public.post_views (user_id, post_id, shared)
    values (v_uid, p_post_id, true)
    on conflict (user_id, post_id) do update
        set shared = true, updated_at = now();

    if v_prior is null or v_prior = false then
        update public.posts set share_count = share_count + 1 where id = p_post_id;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Negative feedback. The exact post becomes a hard filter in get_feed; the
-- affinity penalties below are how the signal GENERALISES to the creator's
-- other posts and to the same hashtags.
-- ---------------------------------------------------------------------------

create or replace function public.mark_not_interested(
    p_post_id uuid,
    p_reason  text default 'not_interested'
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid     uuid := (select auth.uid());
    v_creator uuid;
begin
    if v_uid is null then
        raise exception 'auth required' using errcode = '42501';
    end if;

    insert into public.post_not_interested (user_id, post_id, reason)
    values (v_uid, p_post_id, coalesce(p_reason, 'not_interested'))
    on conflict (user_id, post_id) do update set reason = excluded.reason;

    select user_id into v_creator from public.posts where id = p_post_id;

    if v_creator is not null and v_creator <> v_uid then
        insert into public.user_creator_affinity (user_id, creator_id, score)
        values (v_uid, v_creator, -1.0)
        on conflict (user_id, creator_id) do update
            set score = greatest(public.user_creator_affinity.score - 1.0, -5),
                updated_at = now();
    end if;

    insert into public.user_topic_affinity (user_id, hashtag_id, score)
    select v_uid, ph.hashtag_id, -0.5
    from public.post_hashtags ph
    where ph.post_id = p_post_id
    limit 10
    on conflict (user_id, hashtag_id) do update
        set score = greatest(public.user_topic_affinity.score - 0.5, -5),
            updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create or replace function public.get_notifications(
    p_cursor jsonb   default null,
    p_limit  integer default 30
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
    v_uid uuid        := (select auth.uid());
    v_ts  timestamptz := nullif(p_cursor->>'ts', '')::timestamptz;
    v_id  uuid        := nullif(p_cursor->>'id', '')::uuid;
begin
    if v_uid is null then
        return;
    end if;

    return query
    select n.id, n.type, n.created_at, n.read_at,
           n.actor_id, pr.name, pr.image,
           n.post_id, coalesce(p.poster_key, ''), coalesce(p.video_url, ''), n.preview
    from public.notifications n
    join public.profiles pr on pr.user_id = n.actor_id
    left join public.posts p on p.id = n.post_id and p.deleted_at is null
    where n.user_id = v_uid
      and not exists (select 1 from public.blocks b
                       where b.blocker_id = v_uid and b.blocked_id = n.actor_id)
      and (v_ts is null or (n.created_at, n.id) < (v_ts, v_id))
    order by n.created_at desc, n.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50);
end;
$$;

create or replace function public.get_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select count(*)::int from public.notifications
     where user_id = (select auth.uid()) and read_at is null;
$$;

-- p_ids is an additional filter, never a replacement for the ownership
-- predicate: passing someone else's ids marks nothing.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
    with up as (
        update public.notifications set read_at = now()
        where user_id = (select auth.uid())
          and read_at is null
          and (p_ids is null or id = any(p_ids[1:500]))
        returning 1
    ) select count(*)::int from up;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting and reports.
--
-- Fixed-window counting keyed on auth.uid(), falling back to x-forwarded-for
-- for anonymous callers. This protects data integrity, NOT the database from
-- load: a limited call still costs a connection and a transaction. Real
-- request throttling needs something in front of Postgres.
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_take(
    p_bucket text,
    p_limit  integer,
    p_window interval
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_subject text;
    v_secs    double precision := extract(epoch from p_window);
    v_win     timestamptz;
    v_hits    integer;
begin
    v_subject := coalesce(
        'u:' || (select auth.uid())::text,
        'ip:' || coalesce(nullif(split_part(
            current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''),
            'unknown'));

    v_win := to_timestamp(floor(extract(epoch from now()) / v_secs) * v_secs);

    insert into public.rate_limits (subject, bucket, window_start, hits)
    values (v_subject, p_bucket, v_win, 1)
    on conflict (subject, bucket, window_start)
    do update set hits = public.rate_limits.hits + 1
    returning hits into v_hits;

    return v_hits <= p_limit;
end;
$$;

create or replace function public.report_content(
    p_target_type text,
    p_target_id   uuid,
    p_reason      text,
    p_details     text default ''
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := (select auth.uid());
    v_id  uuid;
begin
    if v_uid is null then
        raise exception 'auth required' using errcode = '42501';
    end if;

    if not public.rate_limit_take('report', 20, interval '1 hour') then
        raise exception 'too many reports, try again later' using errcode = '54000';
    end if;

    insert into public.reports (reporter_id, target_type, reason, details,
                                target_post_id, target_user_id, target_comment_id)
    values (v_uid, p_target_type, p_reason, left(coalesce(p_details, ''), 1000),
            case when p_target_type = 'post'    then p_target_id end,
            case when p_target_type = 'user'    then p_target_id end,
            case when p_target_type = 'comment' then p_target_id end)
    on conflict do nothing
    returning id into v_id;

    -- null means "already reported by you", which the UI treats as success.
    return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operational: recompute every counter from ground truth.
--
-- Triggers keep counters exact in normal operation, so this exists for the two
-- cases they cannot cover: a bulk load that writes post_views directly (the
-- seed script) and verifying that no drift has crept in.
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_counters()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    with p as (
        update public.posts t set
            like_count    = coalesce((select count(*) from public.likes    l where l.post_id = t.id), 0),
            comment_count = coalesce((select count(*) from public.comments c where c.post_id = t.id), 0),
            save_count    = coalesce((select count(*) from public.saves    s where s.post_id = t.id), 0),
            repost_count  = coalesce((select count(*) from public.reposts  r where r.post_id = t.id), 0),
            view_count    = coalesce((select count(*) from public.post_views v where v.post_id = t.id), 0),
            share_count   = coalesce((select count(*) from public.post_views v
                                       where v.post_id = t.id and v.shared), 0)
        -- Supabase loads pg-safeupdate on PostgREST connections, which rejects
        -- any UPDATE without a WHERE clause. These predicates are always true.
        where t.id is not null
        returning 1
    ),
    pr as (
        update public.profiles t set
            follower_count  = coalesce((select count(*) from public.follows f
                                         where f.to_user_id = t.user_id), 0),
            following_count = coalesce((select count(*) from public.follows f
                                         where f.user_id = t.user_id), 0),
            post_count      = coalesce((select count(*) from public.posts x
                                         where x.user_id = t.user_id and x.deleted_at is null), 0)
        where t.user_id is not null
        returning 1
    ),
    h as (
        update public.hashtags t set
            post_count = coalesce((select count(*) from public.post_hashtags ph
                                    where ph.hashtag_id = t.id), 0)
        where t.id is not null
        returning 1
    )
    select null::void from (select 1) z;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Default is EXECUTE to public, so revoke first on everything.
-- ---------------------------------------------------------------------------

revoke execute on function public.refresh_post_scores(interval)           from public, anon, authenticated;
revoke execute on function public.rate_limit_take(text, integer, interval) from public, anon, authenticated;
revoke execute on function public.reconcile_counters()                     from public, anon, authenticated;
-- Both are operational tools, driven by cron or the service role only.
grant execute on function public.refresh_post_scores(interval) to service_role;
grant execute on function public.reconcile_counters()          to service_role;

do $$
declare f text;
begin
    -- Readable by anyone, including logged out.
    foreach f in array array[
        'public.get_feed(jsonb, integer, uuid)',
        'public.get_post(uuid)',
        'public.get_user_posts(uuid, text, jsonb, integer)',
        'public.get_profile(uuid)',
        'public.get_post_engagement(uuid[])',
        'public.get_trending_hashtags(integer, interval)',
        'public.get_trending_creators(integer)',
        'public.search_users(text, integer)',
        'public.search_hashtags(text, integer)',
        'public.search_videos(text, jsonb, integer)',
        'public.get_posts_by_hashtag(text, jsonb, integer)',
        'public.search_top(text)',
        'public.feed_rank_score(integer, integer, integer, integer, integer, integer, real, integer, real, double precision, real, real, boolean, boolean, real, real)',
        'public.normalize_tag(text)'
    ] loop
        execute format('revoke execute on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;

    -- Requires a session.
    foreach f in array array[
        'public.get_following_feed(jsonb, integer)',
        'public.record_watch(uuid, integer, real, integer, boolean)',
        'public.record_view(uuid)',
        'public.record_share(uuid)',
        'public.mark_not_interested(uuid, text)',
        'public.report_content(text, uuid, text, text)',
        'public.get_notifications(jsonb, integer)',
        'public.get_unread_notification_count()',
        'public.mark_notifications_read(uuid[])'
    ] loop
        execute format('revoke execute on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled maintenance. Guarded: pg_cron is not enabled by default on every
-- Supabase plan, and a missing extension must not roll back the functions.
-- ---------------------------------------------------------------------------

do $$
begin
    create extension if not exists pg_cron;

    perform cron.unschedule(jobid) from cron.job
     where jobname in ('refresh-post-scores', 'sweep-feed-seen', 'sweep-rate-limits');

    perform cron.schedule('refresh-post-scores', '*/2 * * * *',
        $c$ select public.refresh_post_scores('15 minutes'::interval) $c$);
    perform cron.schedule('sweep-feed-seen', '17 * * * *',
        $c$ delete from public.feed_seen where served_at < now() - interval '2 days' $c$);
    perform cron.schedule('sweep-rate-limits', '23 * * * *',
        $c$ delete from public.rate_limits where window_start < now() - interval '1 day' $c$);
exception when others then
    raise notice 'pg_cron unavailable (%). Enable it under Database -> Extensions and re-run this block. Until then call public.refresh_post_scores() manually.', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
