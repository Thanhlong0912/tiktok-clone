-- Feed foundation: counters, watch signals, hashtags, notifications, moderation.
-- Run after 0001_init.sql. Idempotent -- safe to re-run.
--
-- Design notes worth keeping in mind before editing:
--
--   * No btree index on any *_count column. Ranking sorts on
--     post_scores.quality_score, never on a raw counter. An index on
--     posts.like_count would turn every like into a non-HOT update plus an
--     index insert on a hot page. fillfactor 85 leaves room for the HOT path.
--   * post_views holds ONE row per (viewer, post), not one per impression.
--     Row count stays bounded at users x posts_seen, and the same row answers
--     "has this user seen it" -- which the feed needs anyway.
--   * Client-reported watch times are clamped here but are NOT trustworthy.
--     Never build anything monetary on avg_watch_ms.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- New columns on existing tables
-- ---------------------------------------------------------------------------

alter table public.posts
    add column if not exists poster_key    text        not null default '',
    add column if not exists duration_ms   integer,
    add column if not exists width         integer,
    add column if not exists height        integer,
    add column if not exists like_count    integer     not null default 0,
    add column if not exists comment_count integer     not null default 0,
    add column if not exists save_count    integer     not null default 0,
    add column if not exists repost_count  integer     not null default 0,
    add column if not exists share_count   integer     not null default 0,
    add column if not exists view_count    integer     not null default 0,
    add column if not exists deleted_at    timestamptz,
    add column if not exists updated_at    timestamptz not null default now();

-- Lets Explore filter image vs video posts without parsing video_url in JS.
-- 'images:' is IMAGE_POST_PREFIX in app/utils/postMedia.ts.
alter table public.posts
    add column if not exists media_kind text
    generated always as (
        case when video_url like 'images:%' then 'image' else 'video' end
    ) stored;

alter table public.posts set (fillfactor = 85);

alter table public.profiles
    add column if not exists follower_count  integer     not null default 0,
    add column if not exists following_count integer     not null default 0,
    add column if not exists post_count      integer     not null default 0,
    add column if not exists updated_at      timestamptz not null default now();

alter table public.profiles set (fillfactor = 85);

alter table public.comments
    add column if not exists deleted_at timestamptz,
    add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- The missing foreign key.
-- posts.user_id and profiles.user_id both point at auth.users but never at
-- each other, so PostgREST embeds (posts -> profiles) do not work at all
-- today -- which is why every read does a profile fetch per row in JS.
-- The auth.users FKs stay: auth is not an exposed schema, so PostgREST sees
-- no ambiguity, and keeping them preserves the cascade.
-- ---------------------------------------------------------------------------

insert into public.profiles (user_id, name, image, bio)
select distinct p.user_id, 'user', 'placeholder-avatar.png', ''
from public.posts p
left join public.profiles pr on pr.user_id = p.user_id
where pr.user_id is null
on conflict (user_id) do nothing;

insert into public.profiles (user_id, name, image, bio)
select distinct c.user_id, 'user', 'placeholder-avatar.png', ''
from public.comments c
left join public.profiles pr on pr.user_id = c.user_id
where pr.user_id is null
on conflict (user_id) do nothing;

do $$
begin
    alter table public.posts
        add constraint posts_user_id_profiles_fkey
        foreign key (user_id) references public.profiles(user_id) on delete cascade;
exception when duplicate_object then null;
end;
$$;

do $$
begin
    alter table public.comments
        add constraint comments_user_id_profiles_fkey
        foreign key (user_id) references public.profiles(user_id) on delete cascade;
exception when duplicate_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Engagement state: one upserted row per (viewer, post)
-- ---------------------------------------------------------------------------

create table if not exists public.post_views (
    user_id        uuid        not null references auth.users(id) on delete cascade,
    post_id        uuid        not null references public.posts(id) on delete cascade,
    watch_ms       integer     not null default 0,   -- cumulative across sessions
    max_completion real        not null default 0,   -- 0..1, best single pass
    loops          integer     not null default 0,
    impressions    integer     not null default 1,
    skipped        boolean     not null default false,
    shared         boolean     not null default false,
    first_seen_at  timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    primary key (user_id, post_id)
);

create index if not exists post_views_post_updated_idx on public.post_views (post_id, updated_at desc);
create index if not exists post_views_updated_idx      on public.post_views (updated_at desc);
create index if not exists post_views_user_updated_idx on public.post_views (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Precomputed ranking inputs. Refreshed in batch by refresh_post_scores so
-- the aggregate over post_views never runs in the request path.
-- ---------------------------------------------------------------------------

create table if not exists public.post_scores (
    post_id        uuid primary key references public.posts(id) on delete cascade,
    viewer_count   integer          not null default 0,
    avg_completion real             not null default 0,
    avg_watch_ms   integer          not null default 0,
    skip_rate      real             not null default 0,
    quality_score  double precision not null default 0,
    ml_score       real,   -- the swap-in seam: wins over the formula when set
    computed_at    timestamptz      not null default now()
);

create index if not exists post_scores_quality_idx
    on public.post_scores (quality_score desc, post_id desc);

-- ---------------------------------------------------------------------------
-- Hashtags. Until now these existed only as #text inside posts.text:
-- unindexed, unsearchable, and re-parsed client-side on every keystroke.
-- ---------------------------------------------------------------------------

create table if not exists public.hashtags (
    id         uuid primary key default gen_random_uuid(),
    tag        text not null unique,
    post_count integer not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists public.post_hashtags (
    post_id    uuid not null references public.posts(id) on delete cascade,
    hashtag_id uuid not null references public.hashtags(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (post_id, hashtag_id)
);

create index if not exists post_hashtags_tag_recent_idx
    on public.post_hashtags (hashtag_id, created_at desc);
create index if not exists hashtags_tag_trgm_idx
    on public.hashtags using gin (tag extensions.gin_trgm_ops);
create index if not exists hashtags_post_count_idx
    on public.hashtags (post_count desc);

-- Must stay byte-identical to normalizeTag() in app/utils/postTags.ts.
-- app/utils/postTags.test.ts asserts the two agree on a shared fixture.
create or replace function public.normalize_tag(p_raw text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
    select left(
        regexp_replace(
            regexp_replace(lower(replace(p_raw, '#', '')), '\s+', '', 'g'),
            '[.,!?;:()\[\]{}''"`~@$%^&*+=\\/|<>]', '', 'g'
        ),
        30
    );
$$;

-- ---------------------------------------------------------------------------
-- Notifications. Replaces the client-side synthesis in useGetActivity, which
-- fanned out over likes+comments+follows and had no read state.
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,  -- recipient
    actor_id   uuid not null references auth.users(id) on delete cascade,
    type       text not null check (type in ('like','comment','follow','repost','mention')),
    post_id    uuid references public.posts(id) on delete cascade,
    comment_id uuid references public.comments(id) on delete set null,
    preview    text not null default '',
    read_at    timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
    on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
    on public.notifications (user_id) where read_at is null;

-- One live notification per (recipient, actor, type, post): unlike/relike
-- bumps the existing row instead of spamming a new one.
create unique index if not exists notifications_dedup_idx
    on public.notifications (
        user_id, actor_id, type,
        coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- Moderation. Tables ship now so no second migration is needed later; only
-- report_content is wired to the UI in this pass.
-- ---------------------------------------------------------------------------

create table if not exists public.reports (
    id                uuid primary key default gen_random_uuid(),
    reporter_id       uuid not null references auth.users(id) on delete cascade,
    target_type       text not null check (target_type in ('post','user','comment')),
    target_post_id    uuid references public.posts(id) on delete cascade,
    target_user_id    uuid references auth.users(id) on delete cascade,
    target_comment_id uuid references public.comments(id) on delete cascade,
    reason            text not null check (reason in
        ('spam','nudity','violence','hate','harassment','misinformation','ip','other')),
    details           text not null default '',
    status            text not null default 'pending'
        check (status in ('pending','reviewing','actioned','dismissed')),
    created_at        timestamptz not null default now(),
    constraint reports_one_target check (
        (target_type = 'post'    and target_post_id    is not null) or
        (target_type = 'user'    and target_user_id    is not null) or
        (target_type = 'comment' and target_comment_id is not null))
);

create unique index if not exists reports_no_dupes_idx on public.reports (
    reporter_id, target_type,
    coalesce(target_post_id, target_user_id, target_comment_id));
create index if not exists reports_status_idx on public.reports (status, created_at desc);

create table if not exists public.blocks (
    blocker_id uuid not null references auth.users(id) on delete cascade,
    blocked_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

create table if not exists public.mutes (
    muter_id   uuid not null references auth.users(id) on delete cascade,
    muted_id   uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (muter_id, muted_id),
    constraint mutes_not_self check (muter_id <> muted_id)
);

-- ---------------------------------------------------------------------------
-- Negative signals and affinity. Affinity is maintained inline by
-- record_watch (bounded: 1 creator + <=10 tag upserts per meaningful watch),
-- not by a batch job -- instant personalisation is the point of the feed.
-- ---------------------------------------------------------------------------

create table if not exists public.post_not_interested (
    user_id    uuid not null references auth.users(id) on delete cascade,
    post_id    uuid not null references public.posts(id) on delete cascade,
    reason     text not null default 'not_interested',
    created_at timestamptz not null default now(),
    primary key (user_id, post_id)
);

create table if not exists public.user_topic_affinity (
    user_id    uuid not null references auth.users(id) on delete cascade,
    hashtag_id uuid not null references public.hashtags(id) on delete cascade,
    score      real not null default 0,   -- may go negative
    source     text not null default 'implicit' check (source in ('implicit','explicit')),
    updated_at timestamptz not null default now(),
    primary key (user_id, hashtag_id)
);
create index if not exists user_topic_affinity_top_idx
    on public.user_topic_affinity (user_id, score desc);

create table if not exists public.user_creator_affinity (
    user_id    uuid not null references auth.users(id) on delete cascade,
    creator_id uuid not null references auth.users(id) on delete cascade,
    score      real not null default 0,
    updated_at timestamptz not null default now(),
    primary key (user_id, creator_id)
);
create index if not exists user_creator_affinity_top_idx
    on public.user_creator_affinity (user_id, score desc);

-- ---------------------------------------------------------------------------
-- Session dedup. This is what makes ranked pagination exact: get_feed writes
-- every served id here in the same statement that selects it, so a post whose
-- score moved between pages can neither duplicate nor disappear.
-- feed_seen = "we served it"; post_views = "they watched it" (permanent).
-- ---------------------------------------------------------------------------

create table if not exists public.feed_seen (
    session_id uuid        not null,
    post_id    uuid        not null references public.posts(id) on delete cascade,
    user_id    uuid        references auth.users(id) on delete cascade,  -- null when logged out
    served_at  timestamptz not null default now(),
    primary key (session_id, post_id)
);
create index if not exists feed_seen_served_idx on public.feed_seen (served_at);

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiting. Protects data integrity, not the database from
-- load -- a limited call still costs a connection and a transaction. Real
-- request throttling needs something in front of Postgres.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limits (
    subject      text        not null,
    bucket       text        not null,
    window_start timestamptz not null,
    hits         integer     not null default 0,
    primary key (subject, bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- Counter triggers.
--
-- Triggers, not RPCs, for likes/comments/saves/reposts/follows/posts: the
-- client already writes these tables directly under RLS, and a trigger in the
-- same transaction cannot drift. Routing them through SECURITY DEFINER RPCs
-- would replace a declarative RLS check with hand-written authorization for
-- no benefit. Views/watch/shares are the opposite case and go through RPC.
-- ---------------------------------------------------------------------------

create or replace function public.bump_post_counter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_col   text := tg_argv[0];
    v_delta int;
    v_post  uuid;
begin
    if tg_op = 'INSERT' then
        v_delta := 1;  v_post := new.post_id;
    else
        v_delta := -1; v_post := old.post_id;
    end if;

    execute format(
        'update public.posts set %I = greatest(%I + $1, 0), updated_at = now() where id = $2',
        v_col, v_col)
    using v_delta, v_post;

    return null;
end;
$$;

drop trigger if exists likes_count_trg on public.likes;
create trigger likes_count_trg after insert or delete on public.likes
    for each row execute function public.bump_post_counter('like_count');

drop trigger if exists comments_count_trg on public.comments;
create trigger comments_count_trg after insert or delete on public.comments
    for each row execute function public.bump_post_counter('comment_count');

drop trigger if exists saves_count_trg on public.saves;
create trigger saves_count_trg after insert or delete on public.saves
    for each row execute function public.bump_post_counter('save_count');

drop trigger if exists reposts_count_trg on public.reposts;
create trigger reposts_count_trg after insert or delete on public.reposts
    for each row execute function public.bump_post_counter('repost_count');

-- Mutual follows would deadlock without a deterministic lock order: A follows
-- B while B follows A means each transaction grabs the other's profile row
-- first. Always touch the lower uuid first.
create or replace function public.bump_follow_counters()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_from  uuid := coalesce(new.user_id, old.user_id);
    v_to    uuid := coalesce(new.to_user_id, old.to_user_id);
    v_delta int  := case when tg_op = 'INSERT' then 1 else -1 end;
    v_id    uuid;
begin
    foreach v_id in array array[least(v_from, v_to), greatest(v_from, v_to)] loop
        update public.profiles
        set following_count = greatest(
                following_count + (case when v_id = v_from then v_delta else 0 end), 0),
            follower_count  = greatest(
                follower_count  + (case when v_id = v_to   then v_delta else 0 end), 0),
            updated_at = now()
        where user_id = v_id;
    end loop;

    return null;
end;
$$;

drop trigger if exists follows_count_trg on public.follows;
create trigger follows_count_trg after insert or delete on public.follows
    for each row execute function public.bump_follow_counters();

create or replace function public.bump_profile_post_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_delta int := 0;
begin
    if tg_op = 'INSERT' then
        v_delta := case when new.deleted_at is null then 1 else 0 end;
    elsif tg_op = 'DELETE' then
        v_delta := case when old.deleted_at is null then -1 else 0 end;
    else
        v_delta := (case when new.deleted_at is null then 1 else 0 end)
                 - (case when old.deleted_at is null then 1 else 0 end);
    end if;

    if v_delta <> 0 then
        update public.profiles
        set post_count = greatest(post_count + v_delta, 0)
        where user_id = coalesce(new.user_id, old.user_id);
    end if;

    return null;
end;
$$;

drop trigger if exists posts_profile_count_trg on public.posts;
create trigger posts_profile_count_trg
    after insert or delete or update of deleted_at on public.posts
    for each row execute function public.bump_profile_post_count();

-- ---------------------------------------------------------------------------
-- Hashtag sync. Dedupes then caps at 10, matching extractHashtags() plus
-- MAX_TAGS_PER_POST in app/utils/postTags.ts.
-- ---------------------------------------------------------------------------

create or replace function public.sync_post_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tag text;
    v_id  uuid;
begin
    if tg_op = 'UPDATE' and new.text is not distinct from old.text then
        return null;
    end if;

    delete from public.post_hashtags where post_id = new.id;

    for v_tag in
        select d.tag
        from (
            select public.normalize_tag(t.m[1]) as tag, min(t.ord) as first_ord
            from regexp_matches(new.text, '#([^\s#]+)', 'g') with ordinality as t(m, ord)
            group by 1
        ) d
        where d.tag <> ''
        order by d.first_ord
        limit 10
    loop
        -- "do update set tag = excluded.tag" is a deliberate no-op: DO NOTHING
        -- returns no row, so v_id would come back null on an existing tag.
        insert into public.hashtags (tag) values (v_tag)
            on conflict (tag) do update set tag = excluded.tag
            returning id into v_id;

        insert into public.post_hashtags (post_id, hashtag_id, created_at)
        values (new.id, v_id, new.created_at)
        on conflict do nothing;
    end loop;

    return null;
end;
$$;

drop trigger if exists posts_sync_hashtags on public.posts;
create trigger posts_sync_hashtags
    after insert or update of text on public.posts
    for each row execute function public.sync_post_hashtags();

-- post_count is maintained on the join table, not inside sync_post_hashtags:
-- editing a caption deletes every link and re-inserts, so incrementing in the
-- sync function alone would drift upward on every edit.
create or replace function public.bump_hashtag_post_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if tg_op = 'INSERT' then
        update public.hashtags set post_count = post_count + 1 where id = new.hashtag_id;
    else
        update public.hashtags set post_count = greatest(post_count - 1, 0) where id = old.hashtag_id;
    end if;
    return null;
end;
$$;

drop trigger if exists post_hashtags_count_trg on public.post_hashtags;
create trigger post_hashtags_count_trg after insert or delete on public.post_hashtags
    for each row execute function public.bump_hashtag_post_count();

-- ---------------------------------------------------------------------------
-- Notification emission. Self-actions are skipped.
-- ---------------------------------------------------------------------------

-- Likes and reposts. Deliberately NOT shared with comments: plpgsql resolves
-- every field reference in an expression when it compiles the statement, even
-- on an unreachable CASE branch, so a single function mentioning new.text
-- would fail on `likes` with `record "new" has no field "text"`.
create or replace function public.notify_post_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_author uuid;
    v_type   text := tg_argv[0];
begin
    select user_id into v_author from public.posts where id = new.post_id;
    if v_author is null or v_author = new.user_id then
        return null;
    end if;

    insert into public.notifications (user_id, actor_id, type, post_id, preview)
    values (v_author, new.user_id, v_type, new.post_id, '')
    on conflict (user_id, actor_id, type,
                 coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set created_at = now(), read_at = null;

    return null;
end;
$$;

create or replace function public.notify_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_author uuid;
begin
    select user_id into v_author from public.posts where id = new.post_id;
    if v_author is null or v_author = new.user_id then
        return null;
    end if;

    insert into public.notifications (user_id, actor_id, type, post_id, comment_id, preview)
    values (v_author, new.user_id, 'comment', new.post_id, new.id, left(new.text, 140))
    on conflict (user_id, actor_id, type,
                 coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
    -- Aggregated, like TikTok: a second comment updates the preview rather
    -- than adding a row. Split the unique index if per-comment rows are wanted.
    do update set created_at = now(),
                  read_at    = null,
                  preview    = excluded.preview,
                  comment_id = excluded.comment_id;

    return null;
end;
$$;

drop trigger if exists likes_notify_trg on public.likes;
create trigger likes_notify_trg after insert on public.likes
    for each row execute function public.notify_post_author('like');

drop trigger if exists comments_notify_trg on public.comments;
create trigger comments_notify_trg after insert on public.comments
    for each row execute function public.notify_comment_author();

drop trigger if exists reposts_notify_trg on public.reposts;
create trigger reposts_notify_trg after insert on public.reposts
    for each row execute function public.notify_post_author('repost');

create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.user_id = new.to_user_id then
        return null;
    end if;

    insert into public.notifications (user_id, actor_id, type)
    values (new.to_user_id, new.user_id, 'follow')
    on conflict (user_id, actor_id, type,
                 coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set created_at = now(), read_at = null;

    return null;
end;
$$;

drop trigger if exists follows_notify_trg on public.follows;
create trigger follows_notify_trg after insert on public.follows
    for each row execute function public.notify_new_follower();

-- ---------------------------------------------------------------------------
-- Generic updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

do $$
declare t text;
begin
    foreach t in array array['posts', 'profiles', 'comments'] loop
        execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
        execute format(
            'create trigger %I_updated_at before update on public.%I '
            'for each row execute function public.set_updated_at()', t, t);
    end loop;
end;
$$;

-- Only the triggers above should call these.
revoke execute on function public.bump_post_counter()       from public, anon, authenticated;
revoke execute on function public.bump_follow_counters()    from public, anon, authenticated;
revoke execute on function public.bump_profile_post_count() from public, anon, authenticated;
revoke execute on function public.sync_post_hashtags()      from public, anon, authenticated;
revoke execute on function public.bump_hashtag_post_count() from public, anon, authenticated;
revoke execute on function public.notify_post_author()      from public, anon, authenticated;
revoke execute on function public.notify_comment_author()   from public, anon, authenticated;
revoke execute on function public.notify_new_follower()     from public, anon, authenticated;
revoke execute on function public.set_updated_at()          from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Feed and profile reads only ever want live posts.
create index if not exists posts_live_created_idx
    on public.posts (created_at desc) where deleted_at is null;
create index if not exists posts_user_live_created_idx
    on public.posts (user_id, created_at desc) where deleted_at is null;
create index if not exists posts_media_kind_idx
    on public.posts (media_kind, created_at desc) where deleted_at is null;

-- profiles_name_idx from 0001 is a btree on lower(name); the search actually
-- issues ilike '%q%', which no btree can serve. These make it an index scan
-- (for patterns of 3+ characters -- shorter queries still degrade, so the
-- client short-circuits below 2).
create index if not exists profiles_name_trgm_idx
    on public.profiles using gin (name extensions.gin_trgm_ops);
create index if not exists posts_text_trgm_idx
    on public.posts using gin (text extensions.gin_trgm_ops);

create index if not exists comments_post_live_idx
    on public.comments (post_id, created_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.post_views            enable row level security;
alter table public.post_scores           enable row level security;
alter table public.hashtags              enable row level security;
alter table public.post_hashtags         enable row level security;
alter table public.notifications         enable row level security;
alter table public.reports               enable row level security;
alter table public.blocks                enable row level security;
alter table public.mutes                 enable row level security;
alter table public.post_not_interested   enable row level security;
alter table public.user_topic_affinity   enable row level security;
alter table public.user_creator_affinity enable row level security;
alter table public.feed_seen             enable row level security;
alter table public.rate_limits           enable row level security;

-- Public reference data.
drop policy if exists hashtags_select_all on public.hashtags;
create policy hashtags_select_all on public.hashtags for select using (true);

drop policy if exists post_hashtags_select_all on public.post_hashtags;
create policy post_hashtags_select_all on public.post_hashtags for select using (true);

drop policy if exists post_scores_select_all on public.post_scores;
create policy post_scores_select_all on public.post_scores for select using (true);

-- Owner-only. (select auth.uid()) so the planner evaluates it once as an
-- InitPlan rather than once per row.
do $$
declare t text;
begin
    foreach t in array array['post_views', 'post_not_interested',
                             'user_topic_affinity', 'user_creator_affinity'] loop
        execute format('drop policy if exists "%s_own" on public.%I', t, t);
        execute format(
            'create policy "%s_own" on public.%I for all '
            'using ((select auth.uid()) = user_id) '
            'with check ((select auth.uid()) = user_id)', t, t);
    end loop;
end;
$$;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
    for select using ((select auth.uid()) = user_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
    for update using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
-- No insert policy: only the SECURITY DEFINER triggers create notifications.

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
    for insert with check ((select auth.uid()) = reporter_id);

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
    for select using ((select auth.uid()) = reporter_id);

-- Scoped to the actor so a blocked user cannot discover they were blocked.
drop policy if exists blocks_own on public.blocks;
create policy blocks_own on public.blocks for all
    using ((select auth.uid()) = blocker_id)
    with check ((select auth.uid()) = blocker_id);

drop policy if exists mutes_own on public.mutes;
create policy mutes_own on public.mutes for all
    using ((select auth.uid()) = muter_id)
    with check ((select auth.uid()) = muter_id);

-- feed_seen and rate_limits get NO policies at all: RLS is on, so they are
-- invisible to anon/authenticated and reachable only by definer functions.

-- Soft delete: an author still sees their own removed content, nobody else does.
drop policy if exists posts_select_all on public.posts;
create policy posts_select_all on public.posts
    for select using (deleted_at is null or (select auth.uid()) = user_id);

drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments
    for select using (deleted_at is null or (select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- One-time backfill
-- ---------------------------------------------------------------------------

-- Hashtags out of existing captions. Two statements, not one CTE: a
-- data-modifying CTE that inserts into hashtags and then joins hashtags sees
-- the pre-statement snapshot and finds nothing.
insert into public.hashtags (tag)
select distinct public.normalize_tag(t.m[1])
from public.posts p, lateral regexp_matches(p.text, '#([^\s#]+)', 'g') as t(m)
where public.normalize_tag(t.m[1]) <> ''
on conflict (tag) do nothing;

insert into public.post_hashtags (post_id, hashtag_id, created_at)
select x.post_id, h.id, x.created_at
from (
    select p.id as post_id,
           p.created_at,
           d.tag,
           row_number() over (partition by p.id order by d.first_ord) as rn
    from public.posts p
    cross join lateral (
        select public.normalize_tag(t.m[1]) as tag, min(t.ord) as first_ord
        from regexp_matches(p.text, '#([^\s#]+)', 'g') with ordinality as t(m, ord)
        group by 1
    ) d
    where d.tag <> ''
) x
join public.hashtags h on h.tag = x.tag
where x.rn <= 10
on conflict do nothing;

update public.hashtags h
set post_count = coalesce(c.n, 0)
from (select hashtag_id, count(*) as n from public.post_hashtags group by 1) c
where c.hashtag_id = h.id;

-- Counters from ground truth.
update public.posts p set
    like_count    = coalesce((select count(*) from public.likes    l where l.post_id = p.id), 0),
    comment_count = coalesce((select count(*) from public.comments c where c.post_id = p.id), 0),
    save_count    = coalesce((select count(*) from public.saves    s where s.post_id = p.id), 0),
    repost_count  = coalesce((select count(*) from public.reposts  r where r.post_id = p.id), 0);

update public.profiles pr set
    follower_count  = coalesce((select count(*) from public.follows f
                                 where f.to_user_id = pr.user_id), 0),
    following_count = coalesce((select count(*) from public.follows f
                                 where f.user_id = pr.user_id), 0),
    post_count      = coalesce((select count(*) from public.posts p
                                 where p.user_id = pr.user_id and p.deleted_at is null), 0);

insert into public.post_scores (post_id)
select id from public.posts
on conflict do nothing;

-- Make everything visible to the REST API immediately.
notify pgrst, 'reload schema';
