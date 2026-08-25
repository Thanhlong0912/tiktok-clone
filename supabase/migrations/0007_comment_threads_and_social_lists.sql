-- Comment threading, comment likes, and the account lists PostgREST cannot
-- serve on its own. Run after 0006_hardening.sql. Idempotent -- safe to re-run.
--
-- Three things ship in one file because they share one root cause: every
-- social list in this app joins a relation table (follows, blocks, mutes) to
-- public.profiles, and NONE of those tables has a foreign key to profiles --
-- they all reference auth.users, which PostgREST cannot traverse. So a
-- resource embed is impossible and the read has to be an RPC, exactly as it
-- was for comments before 0002 added comments_user_id_profiles_fkey.
--
-- Two rules from 0003 still hold for everything below:
--
--   1. Definer functions bypass RLS, so the `deleted_at is null` and
--      block/mute predicates inside them are the only thing standing in for it.
--   2. Writers derive the actor from `(select auth.uid())`, never an argument.
--
-- Two more that are specific to this file:
--
--   3. Comments are two levels deep, never three. A bounded depth means the
--      cascade below is one level, the reply counter has exactly one owner,
--      and no read is recursive.
--   4. The read functions are `language sql`, not plpgsql. They need no local
--      state, and an OUT parameter named `text` -- which is what a RETURNS
--      TABLE column becomes in plpgsql -- is a name worth not shadowing.

-- ---------------------------------------------------------------------------
-- 0. Lock discipline.
--
-- Every ALTER TABLE below takes ACCESS EXCLUSIVE on public.comments. None of
-- them rewrites the table (a nullable column, and a NOT NULL column with a
-- constant default, are catalog-only since PG11) so each is instantaneous --
-- but "instantaneous" only starts once the lock is granted, and the request
-- queues in FRONT of every subsequent reader. One long-running select on
-- comments would otherwise stall the comment section for its whole duration.
--
-- Failing fast is the right outcome: this file is idempotent, so a timeout
-- means "retry in a quieter moment", never "half-applied schema".
-- ---------------------------------------------------------------------------

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Threading columns.
--
-- fillfactor for the same reason 0002 set it on posts and profiles: comments
-- becomes an UPDATE-hot table for the first time today (like_count,
-- reply_count), neither new column is indexed, so leaving free space on the
-- page keeps those bumps on the HOT path instead of writing a new index tuple.
--
-- The self-referencing foreign key is added NOT VALID and validated in a
-- separate statement on purpose. Inline, it would hold ACCESS EXCLUSIVE while
-- it scanned every existing row; split out, the validation pass runs under
-- SHARE UPDATE EXCLUSIVE and blocks neither readers nor writers.
-- ---------------------------------------------------------------------------

alter table public.comments
    add column if not exists parent_id   uuid,
    add column if not exists like_count  integer not null default 0,
    add column if not exists reply_count integer not null default 0;

alter table public.comments set (fillfactor = 85);

-- Partial, because most comments are not replies and the rest would sit in
-- this index as null keys for nothing. `parent_id = $1` with a non-null $1
-- implies the predicate, so the planner still uses it -- including for the
-- ON DELETE CASCADE lookup, which is 0004's finding applied to a self-FK.
create index if not exists comments_parent_created_idx
    on public.comments (parent_id, created_at, id)
    where parent_id is not null;

-- Serves get_post_comments as an index scan rather than a filter.
-- comments_post_live_idx from 0002 leads on the same column but cannot skip
-- replies, which on a busy post are most of the rows.
create index if not exists comments_post_root_created_idx
    on public.comments (post_id, created_at desc, id desc)
    where deleted_at is null and parent_id is null;

do $$
begin
    alter table public.comments
        add constraint comments_parent_id_fkey
        foreign key (parent_id) references public.comments(id) on delete cascade
        not valid;
exception when duplicate_object then null;
end;
$$;

-- A no-op once the constraint is already validated, so this re-runs cleanly.
alter table public.comments validate constraint comments_parent_id_fkey;

-- ---------------------------------------------------------------------------
-- 2. Comment likes.
--
-- (user_id, comment_id) is the primary key rather than a surrogate id: it is
-- the uniqueness rule, it is the probe get_post_comments issues for is_liked,
-- and it is the same probe issued again with the post author substituted for
-- the creator's heart. One index, three jobs -- which is why this table does
-- not follow the `likes` shape from 0001.
-- ---------------------------------------------------------------------------

create table if not exists public.comment_likes (
    user_id    uuid        not null references auth.users(id) on delete cascade,
    comment_id uuid        not null references public.comments(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, comment_id)
);

-- Covers the FK: without it, deleting a comment sequentially scans this table.
create index if not exists comment_likes_comment_idx
    on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;

-- Owner-only for SELECT as well as for writes. Nothing needs to enumerate who
-- liked a comment -- the aggregate lives on comments.like_count, and the read
-- RPCs are SECURITY DEFINER so they see the rows regardless.
drop policy if exists comment_likes_own on public.comment_likes;
create policy comment_likes_own on public.comment_likes for all
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3. Column-level grants, continuing 0006 section 2.
--
-- 0006 closed this for posts and profiles. comments was left out because it
-- had no counters; as of section 1 it has two, so without this a user could
-- PATCH their own comment's like_count and buy the top slot in every thread.
-- RLS does not catch it: RLS restricts WHICH ROWS, never WHICH COLUMNS.
--
-- INSERT is hardened too, which 0006 did not do for any table: the counters
-- are equally settable one statement earlier, and "post a comment that arrives
-- with 900 likes" is the same attack. Naming only the four columns the client
-- actually sends is enough -- an INSERT needs privilege on the columns it
-- names, and defaults still fire for id and created_at.
--
-- parent_id is deliberately absent from the UPDATE grant. Re-parenting a
-- comment after the fact would silently desynchronise two reply_counts, and
-- nothing in the product needs it.
-- ---------------------------------------------------------------------------

revoke insert on public.comments from anon, authenticated;
grant  insert (user_id, post_id, text, parent_id) on public.comments to authenticated;

revoke update on public.comments from anon, authenticated;
grant  update (text, deleted_at) on public.comments to authenticated;

-- No UPDATE path at all on comment_likes, for the reason 0006 gave about
-- storage objects: a like is inserted or deleted, never edited, so leaving the
-- privilege ungranted removes the surface instead of policing it.
revoke update on public.comment_likes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Two levels, never three.
--
-- A CHECK constraint cannot look at another row, so this is a trigger. It also
-- enforces that a reply belongs to the same post as its parent -- without that
-- a reply could be filed under a different post and be unreachable from both.
--
-- SECURITY DEFINER so RLS cannot hide the parent from the lookup: a
-- soft-deleted parent belonging to somebody else is invisible to the caller,
-- and a non-definer read would report that as a bogus "does not exist".
--
-- The read is not as racy as it looks. parent_id is not grantable to
-- authenticated (section 3), so a root cannot become a reply underneath us;
-- and the parent being deleted between this SELECT and commit is closed by the
-- foreign key, which takes a KEY SHARE lock on the parent and makes the
-- concurrent delete wait.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_comment_reply_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_parent_post   uuid;
    v_parent_parent uuid;
begin
    if new.parent_id is null then
        return new;
    end if;

    if new.parent_id = new.id then
        raise exception 'a comment cannot reply to itself'
            using errcode = '23514';
    end if;

    select c.post_id, c.parent_id
      into v_parent_post, v_parent_parent
      from public.comments c
     where c.id = new.parent_id;

    if v_parent_post is null then
        raise exception 'parent comment % does not exist', new.parent_id
            using errcode = '23503';
    end if;

    if v_parent_parent is not null then
        raise exception 'replies are one level deep -- reply to the top-level comment instead'
            using errcode = '23514';
    end if;

    if v_parent_post <> new.post_id then
        raise exception 'a reply must belong to the same post as its parent'
            using errcode = '23514';
    end if;

    -- Only reachable via service_role, the one role that can still write
    -- parent_id. Turning a comment that already has replies into a reply is
    -- how a three-level thread would appear without any single row ever
    -- breaking the rule above.
    if tg_op = 'UPDATE'
       and exists (select 1 from public.comments r where r.parent_id = new.id) then
        raise exception 'cannot make a comment that already has replies into a reply'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

drop trigger if exists comments_reply_rules_trg on public.comments;
create trigger comments_reply_rules_trg
    before insert or update of parent_id, post_id on public.comments
    for each row execute function public.enforce_comment_reply_rules();

-- ---------------------------------------------------------------------------
-- 5. Counter triggers.
--
-- Two functions rather than one parameterised by column name, for the reason
-- 0002 gives above notify_post_author: plpgsql resolves every field reference
-- when it compiles a statement, even on a branch that cannot be reached, so a
-- shared function mentioning new.comment_id would fail on public.comments with
-- `record "new" has no field "comment_id"`.
--
-- LOCK ORDER. Inserting a reply now touches two tables: posts (via
-- comments_count_trg, unchanged from 0002) and comments (the parent row).
-- AFTER ROW triggers fire in NAME order, and `comments_count_trg` sorts before
-- `comments_reply_count_trg`, so every reply acquires posts BEFORE comments
-- and the order is identical in every transaction. Preserve that alphabetical
-- relationship if either trigger is ever renamed.
--
-- Both use greatest(n - 1, 0): a delete racing a reconcile, or a historical
-- row deleted before its counter existed, must not render as "-1 replies".
--
-- Neither sets updated_at -- comments_updated_at from 0002 is a BEFORE UPDATE
-- trigger and has already done it by the time these run.
-- ---------------------------------------------------------------------------

create or replace function public.bump_comment_like_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_delta   int;
    v_comment uuid;
begin
    if tg_op = 'INSERT' then
        v_delta := 1;  v_comment := new.comment_id;
    else
        v_delta := -1; v_comment := old.comment_id;
    end if;

    -- Matches zero rows when the comment is being cascade-deleted underneath
    -- us, which is exactly right: there is no counter left to correct.
    update public.comments
       set like_count = greatest(like_count + v_delta, 0)
     where id = v_comment;

    return null;
end;
$$;

drop trigger if exists comment_likes_count_trg on public.comment_likes;
create trigger comment_likes_count_trg after insert or delete on public.comment_likes
    for each row execute function public.bump_comment_like_count();

create or replace function public.bump_comment_reply_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_delta  int;
    v_parent uuid;
begin
    if tg_op = 'INSERT' then
        v_delta := 1;  v_parent := new.parent_id;
    else
        v_delta := -1; v_parent := old.parent_id;
    end if;

    -- A top-level comment has no parent to bump.
    if v_parent is null then
        return null;
    end if;

    -- On a cascade (parent deleted, replies follow) the parent is already gone
    -- from this transaction's snapshot by the time the RI trigger issues the
    -- child deletes, so this matches zero rows. That is why deleting a thread
    -- needs no special handling here -- while posts.comment_count DOES
    -- decrement once per cascaded reply, because comments_count_trg fires per
    -- row and counted each of those replies on the way in.
    update public.comments
       set reply_count = greatest(reply_count + v_delta, 0)
     where id = v_parent;

    return null;
end;
$$;

drop trigger if exists comments_reply_count_trg on public.comments;
create trigger comments_reply_count_trg after insert or delete on public.comments
    for each row execute function public.bump_comment_reply_count();

-- ---------------------------------------------------------------------------
-- 6. Reply notifications.
--
-- A reply belongs to the person being replied to, not to the post author --
-- otherwise a creator's Activity tab fills with a conversation between two
-- other people while the person actually addressed hears nothing.
--
-- Top-level behaviour is unchanged. With parent_id null, v_target starts null,
-- falls through to the posts lookup, and the insert below is the 0002
-- statement verbatim including its aggregating ON CONFLICT.
--
-- No new notification type. 'comment' already means "somebody wrote something
-- under your thing", the recipient's own copy of the comment is what
-- disambiguates it, and adding a type would mean widening the CHECK in 0002,
-- the validation list in 0006 and the tab set in the client for no new
-- information.
-- ---------------------------------------------------------------------------

create or replace function public.notify_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_target uuid;
begin
    if new.parent_id is not null then
        select c.user_id into v_target
          from public.comments c
         where c.id = new.parent_id;
    end if;

    -- Two paths land here: a top-level comment, and a reply to your OWN
    -- comment -- where notifying yourself is pointless but the post author is
    -- still interested.
    if v_target is null or v_target = new.user_id then
        select p.user_id into v_target
          from public.posts p
         where p.id = new.post_id;
    end if;

    if v_target is null or v_target = new.user_id then
        return null;
    end if;

    insert into public.notifications (user_id, actor_id, type, post_id, comment_id, preview)
    values (v_target, new.user_id, 'comment', new.post_id, new.id, left(new.text, 140))
    on conflict (user_id, actor_id, type,
                 coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
    -- Aggregated, like TikTok: a second comment updates the preview rather
    -- than adding a row. Split the unique index if per-comment rows are wanted.
    -- Note this now also aggregates a reply together with a top-level comment
    -- from the same actor on the same post whenever the recipient happens to
    -- be the same person; comment_id points at whichever landed last, so the
    -- deep link still lands on the newest of the two.
    do update set created_at = now(),
                  read_at    = null,
                  preview    = excluded.preview,
                  comment_id = excluded.comment_id;

    return null;
end;
$$;

-- Deliberately NO notification for a comment like. It would have to be
-- type 'like' carrying the comment's post_id, which collides in
-- notifications_dedup_idx with a like on the post itself: liking both would
-- leave a single row that reads as neither.

-- ---------------------------------------------------------------------------
-- 7. Comment reads.
--
-- Both return the identical column list, so one client component renders a
-- reply and a top-level comment without branching. Both are readable logged
-- out, because the post page renders its thread before anybody signs in.
--
-- Both filter `deleted_at is null` strictly, which is narrower than the
-- comments_select_all policy ("or it is yours"). That policy exists so a
-- creator can still see their own removed POST; a soft-deleted comment has no
-- such surface, and the strict predicate is what lets
-- comments_post_root_created_idx serve the read as an index scan.
--
-- The lateral join on posts is doing two jobs: it resolves the post author
-- once for is_post_author and the creator's-heart probe, and it is the
-- visibility gate -- a deleted post nobody owns yields no row, so the whole
-- query returns empty instead of leaking a thread.
-- ---------------------------------------------------------------------------

create or replace function public.get_post_comments(
    p_post_id uuid,
    p_cursor  jsonb   default null,
    p_limit   integer default 20
)
returns table (
    id              uuid,
    post_id         uuid,
    parent_id       uuid,
    user_id         uuid,
    text            text,
    created_at      timestamptz,
    like_count      integer,
    reply_count     integer,
    is_liked        boolean,
    is_author_liked boolean,
    is_post_author  boolean,
    profile_name    text,
    profile_image   text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select c.id, c.post_id, c.parent_id, c.user_id, c.text, c.created_at,
           c.like_count, c.reply_count,
           exists (select 1 from public.comment_likes cl
                    where cl.comment_id = c.id and cl.user_id = (select auth.uid())),
           -- The creator's heart. A primary-key probe, same as is_liked.
           exists (select 1 from public.comment_likes cl
                    where cl.comment_id = c.id and cl.user_id = a.author),
           c.user_id = a.author,
           pr.name, pr.image
    from public.comments c
    join public.profiles pr on pr.user_id = c.user_id
    cross join lateral (
        select p.user_id as author
          from public.posts p
         where p.id = p_post_id
           and (p.deleted_at is null or p.user_id = (select auth.uid()))
    ) a
    where c.post_id = p_post_id
      and c.parent_id is null
      and c.deleted_at is null
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = c.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = c.user_id))
      and not exists (select 1 from public.mutes m
                       where m.muter_id = (select auth.uid()) and m.muted_id = c.user_id)
      -- Newest first, matching what the comment list has always shown.
      and (nullif(p_cursor->>'ts', '')::timestamptz is null
           or (c.created_at, c.id)
              < (nullif(p_cursor->>'ts', '')::timestamptz, nullif(p_cursor->>'id', '')::uuid))
    order by c.created_at desc, c.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create or replace function public.get_comment_replies(
    p_parent_id uuid,
    p_cursor    jsonb   default null,
    p_limit     integer default 10
)
returns table (
    id              uuid,
    post_id         uuid,
    parent_id       uuid,
    user_id         uuid,
    text            text,
    created_at      timestamptz,
    like_count      integer,
    reply_count     integer,
    is_liked        boolean,
    is_author_liked boolean,
    is_post_author  boolean,
    profile_name    text,
    profile_image   text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select c.id, c.post_id, c.parent_id, c.user_id, c.text, c.created_at,
           c.like_count, c.reply_count,
           exists (select 1 from public.comment_likes cl
                    where cl.comment_id = c.id and cl.user_id = (select auth.uid())),
           exists (select 1 from public.comment_likes cl
                    where cl.comment_id = c.id and cl.user_id = p.user_id),
           c.user_id = p.user_id,
           pr.name, pr.image
    from public.comments c
    -- `parent.parent_id is null` here is not redundant with section 4: it is
    -- what makes an id that is ITSELF a reply return empty, rather than
    -- quietly behaving like a third level.
    join public.comments parent
      on parent.id = p_parent_id and parent.parent_id is null and parent.deleted_at is null
    join public.posts p
      on p.id = parent.post_id
     and (p.deleted_at is null or p.user_id = (select auth.uid()))
    join public.profiles pr on pr.user_id = c.user_id
    where c.parent_id = p_parent_id
      and c.deleted_at is null
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = c.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = c.user_id))
      and not exists (select 1 from public.mutes m
                       where m.muter_id = (select auth.uid()) and m.muted_id = c.user_id)
      -- ASC, and the comparison flips with it: a thread is a conversation and
      -- reads oldest-first, unlike the list of comments above it.
      and (nullif(p_cursor->>'ts', '')::timestamptz is null
           or (c.created_at, c.id)
              > (nullif(p_cursor->>'ts', '')::timestamptz, nullif(p_cursor->>'id', '')::uuid))
    order by c.created_at asc, c.id asc
    limit least(greatest(coalesce(p_limit, 10), 1), 30);
$$;

-- ---------------------------------------------------------------------------
-- 8. Follower and following lists.
--
-- get_following_ACCOUNTS, not get_following: get_following_feed already exists
-- and returns posts, and two functions one word apart returning different
-- things is a bug waiting for a tired reader.
--
-- The keyset is ordered by the FOLLOW EDGE's created_at, but broken by the
-- listed profile's user_id rather than by follows.id. Two reasons, and the
-- first is decisive: follows.id is not in the result set, so a client holding
-- a page could not build the next cursor from it without a second query.
-- The second is that it is just as unique -- `unique (user_id, to_user_id)`
-- from 0001 means that once one side is pinned by the WHERE clause, the other
-- side is a key. A cursor is still not interchangeable between the two
-- functions, because `id` means the follower in one and the followee in the
-- other.
--
-- The indexes carry that tiebreaker as their third column so the ORDER BY is
-- satisfied by the index alone, with no sort node.
--
-- is_self uses `is not distinct from` rather than `=`: with no session,
-- `pr.user_id = null` is NULL, and the client would receive a JSON null where
-- it expects false.
-- ---------------------------------------------------------------------------

create index if not exists follows_to_user_created_idx
    on public.follows (to_user_id, created_at desc, user_id desc);
create index if not exists follows_user_created_idx
    on public.follows (user_id, created_at desc, to_user_id desc);

create or replace function public.get_followers(
    p_user_id uuid,
    p_cursor  jsonb   default null,
    p_limit   integer default 24
)
returns table (
    user_id        uuid,
    name           text,
    image          text,
    bio            text,
    follower_count integer,
    is_following   boolean,
    is_self        boolean,
    followed_at    timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count,
           exists (select 1 from public.follows mf
                    where mf.user_id = (select auth.uid()) and mf.to_user_id = pr.user_id),
           pr.user_id is not distinct from (select auth.uid()),
           f.created_at
    from public.follows  f
    join public.profiles pr on pr.user_id = f.user_id
    where f.to_user_id = p_user_id
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = pr.user_id))
      and (nullif(p_cursor->>'ts', '')::timestamptz is null
           or (f.created_at, f.user_id)
              < (nullif(p_cursor->>'ts', '')::timestamptz, nullif(p_cursor->>'id', '')::uuid))
    order by f.created_at desc, f.user_id desc
    limit least(greatest(coalesce(p_limit, 24), 1), 48);
$$;

create or replace function public.get_following_accounts(
    p_user_id uuid,
    p_cursor  jsonb   default null,
    p_limit   integer default 24
)
returns table (
    user_id        uuid,
    name           text,
    image          text,
    bio            text,
    follower_count integer,
    is_following   boolean,
    is_self        boolean,
    followed_at    timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select pr.user_id, pr.name, pr.image, pr.bio, pr.follower_count,
           exists (select 1 from public.follows mf
                    where mf.user_id = (select auth.uid()) and mf.to_user_id = pr.user_id),
           pr.user_id is not distinct from (select auth.uid()),
           f.created_at
    from public.follows  f
    join public.profiles pr on pr.user_id = f.to_user_id
    where f.user_id = p_user_id
      and not exists (select 1 from public.blocks b
                       where (b.blocker_id = (select auth.uid()) and b.blocked_id = pr.user_id)
                          or (b.blocked_id = (select auth.uid()) and b.blocker_id = pr.user_id))
      and (nullif(p_cursor->>'ts', '')::timestamptz is null
           or (f.created_at, f.to_user_id)
              < (nullif(p_cursor->>'ts', '')::timestamptz, nullif(p_cursor->>'id', '')::uuid))
    order by f.created_at desc, f.to_user_id desc
    limit least(greatest(coalesce(p_limit, 24), 1), 48);
$$;

-- ---------------------------------------------------------------------------
-- 9. Blocked and muted account management.
--
-- Neither takes a user argument. The subject is auth.uid() and only auth.uid():
-- a p_user_id parameter on a SECURITY DEFINER function is exactly how "show me
-- who YOU have blocked" ships by accident, and blocks_own exists in the first
-- place so that a blocked user cannot discover they were blocked.
--
-- No cursor. These lists are curated by hand and are short; the cap IS the
-- pagination. If one ever needs paging, add a cursor rather than raise the cap.
--
-- LEFT JOIN, not JOIN: if a profile row is ever missing the entry must still
-- be listed, because this screen is the only place it can be removed.
--
-- No extra index: blocks is keyed (blocker_id, blocked_id) and mutes
-- (muter_id, muted_id), so both are leading-column scans of their primary key.
-- ---------------------------------------------------------------------------

create or replace function public.get_blocked_accounts(p_limit integer default 100)
returns table (
    user_id    uuid,
    name       text,
    image      text,
    bio        text,
    created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select b.blocked_id,
           coalesce(pr.name, 'Unknown account'),
           coalesce(pr.image, ''),
           coalesce(pr.bio, ''),
           b.created_at
    from public.blocks b
    left join public.profiles pr on pr.user_id = b.blocked_id
    where b.blocker_id = (select auth.uid())
    order by b.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

create or replace function public.get_muted_accounts(p_limit integer default 100)
returns table (
    user_id    uuid,
    name       text,
    image      text,
    bio        text,
    created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select m.muted_id,
           coalesce(pr.name, 'Unknown account'),
           coalesce(pr.image, ''),
           coalesce(pr.bio, ''),
           m.created_at
    from public.mutes m
    left join public.profiles pr on pr.user_id = m.muted_id
    where m.muter_id = (select auth.uid())
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- 10. reconcile_counters() learns about the two new columns.
--
-- Same signature, so CREATE OR REPLACE preserves its service_role-only grant.
-- Without this, the one tool that recomputes counters from ground truth would
-- silently ignore the counters added today and any drift in them would be
-- permanent.
--
-- Both new counters include soft-deleted rows, matching their triggers, which
-- fire on INSERT and DELETE only. That is the same choice comment_count
-- already makes.
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
    ),
    cm as (
        update public.comments t set
            like_count  = coalesce((select count(*) from public.comment_likes cl
                                     where cl.comment_id = t.id), 0),
            reply_count = coalesce((select count(*) from public.comments r
                                     where r.parent_id = t.id), 0)
        where t.id is not null
        returning 1
    )
    select null::void from (select 1) z;
$$;

-- ---------------------------------------------------------------------------
-- 11. Backfill.
--
-- Guarded, unlike the unconditional backfill in 0002: on a first run there are
-- no comment_likes and no replies, so both statements match zero rows and the
-- hot table is not rewritten just to store the zeroes that ALTER TABLE already
-- defaulted in. They exist so that a re-run repairs real drift.
--
-- They only repair counters where evidence exists; a counter left too high on
-- a comment with no likes at all is invisible here. reconcile_counters() above
-- is the exhaustive pass.
-- ---------------------------------------------------------------------------

update public.comments c
   set like_count = x.n
  from (select cl.comment_id, count(*)::int as n
          from public.comment_likes cl group by 1) x
 where x.comment_id = c.id
   and c.like_count is distinct from x.n;

update public.comments c
   set reply_count = x.n
  from (select r.parent_id, count(*)::int as n
          from public.comments r where r.parent_id is not null group by 1) x
 where x.parent_id = c.id
   and c.reply_count is distinct from x.n;

reset lock_timeout;

-- ---------------------------------------------------------------------------
-- 12. Grants. Default is EXECUTE to public, so revoke first on everything.
-- ---------------------------------------------------------------------------

-- Trigger-only. notify_comment_author was already revoked in 0002 and CREATE
-- OR REPLACE preserves the ACL; restated so this file is self-contained and
-- the grant cannot drift out from under the replacement above.
revoke execute on function public.enforce_comment_reply_rules() from public, anon, authenticated;
revoke execute on function public.bump_comment_like_count()     from public, anon, authenticated;
revoke execute on function public.bump_comment_reply_count()    from public, anon, authenticated;
revoke execute on function public.notify_comment_author()       from public, anon, authenticated;

do $$
declare f text;
begin
    -- Readable by anyone, including logged out: the post page renders its
    -- comment thread, and a profile's follower list, before anybody signs in.
    foreach f in array array[
        'public.get_post_comments(uuid, jsonb, integer)',
        'public.get_comment_replies(uuid, jsonb, integer)',
        'public.get_followers(uuid, jsonb, integer)',
        'public.get_following_accounts(uuid, jsonb, integer)'
    ] loop
        execute format('revoke execute on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;

    -- Requires a session. There is no anonymous block list.
    foreach f in array array[
        'public.get_blocked_accounts(integer)',
        'public.get_muted_accounts(integer)'
    ] loop
        execute format('revoke execute on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end;
$$;

notify pgrst, 'reload schema';
