import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { fetchFeed, fetchPost, fetchUserPosts, type FeedKind } from '../utils/feed';
import {
    createFeedSession,
    nextFeedCursor,
    type FeedCursor,
} from '../utils/feedCursor';
import { PostWithProfile } from '../types';

/**
 * Feed state.
 *
 * Deliberately NOT persisted. The old store wrote the whole 100-post array to
 * localStorage under the shared key 'store' (which every other store also used,
 * so they clobbered each other). Persisting a page of a ranked, cursor
 * paginated feed is worse than useless: the cursor does not survive a reload,
 * and showing a stale ranking is worse than showing a skeleton for 200ms.
 */

const PAGE_SIZE = 8

interface PostStore {
    allPosts: PostWithProfile[];
    postsByUser: PostWithProfile[];
    postById: PostWithProfile | null;

    feedKind: FeedKind;
    isFeedLoading: boolean;
    isPageLoading: boolean;
    feedError: boolean;
    hasMore: boolean;

    setFeedKind: (kind: FeedKind) => void;
    setAllPosts: () => Promise<void>;
    loadMorePosts: () => Promise<void>;
    refreshFeed: () => Promise<void>;
    removePost: (postId: string) => void;
    patchPost: (postId: string, patch: Partial<PostWithProfile>) => void;

    setPostsByUser: (userId: string) => Promise<void>;
    setPostById: (postId: string) => Promise<void>;
}

// Cursor and session live outside the store: they are transport details, not
// render state, and nothing should re-render when they change.
let cursor: FeedCursor | null = null
let session = ''
let startedAt = ''
let inFlight: Promise<void> | null = null

const resetPaging = () => {
    cursor = null
    session = createFeedSession()
    startedAt = new Date().toISOString()
}

export const usePostStore = create<PostStore>()(
    devtools((set, get) => ({
        allPosts: [],
        postsByUser: [],
        postById: null,

        feedKind: 'for-you',
        isFeedLoading: false,
        isPageLoading: false,
        feedError: false,
        hasMore: true,

        setFeedKind: (kind: FeedKind) => {
            if (get().feedKind === kind) return
            resetPaging()
            set({ feedKind: kind, allPosts: [], hasMore: true, feedError: false })
            void get().setAllPosts()
        },

        setAllPosts: async () => {
            // Already have a page and a live session: nothing to do. This is
            // what stops the feed refetching on every mount.
            if (get().allPosts.length > 0 && session) return

            resetPaging()
            set({ isFeedLoading: true, feedError: false, hasMore: true })

            try {
                const posts = await fetchFeed(get().feedKind, null, session, PAGE_SIZE)
                cursor = nextFeedCursor(null, session, posts, startedAt)
                set({
                    allPosts: posts,
                    isFeedLoading: false,
                    hasMore: posts.length >= PAGE_SIZE,
                })
            } catch (error) {
                console.error(error)
                set({ isFeedLoading: false, feedError: true })
            }
        },

        loadMorePosts: async () => {
            const state = get()
            if (!state.hasMore || state.isPageLoading || state.isFeedLoading) return
            // Coalesce: the scroll handler can fire several times before the
            // first request lands.
            if (inFlight) return inFlight

            set({ isPageLoading: true })

            inFlight = (async () => {
                try {
                    const posts = await fetchFeed(state.feedKind, cursor, session, PAGE_SIZE)

                    if (posts.length < 1) {
                        set({ isPageLoading: false, hasMore: false })
                        return
                    }

                    cursor = nextFeedCursor(cursor, session, posts, startedAt)

                    // get_feed dedups server-side via feed_seen, but the
                    // following feed is a plain keyset -- guard both.
                    const existing: Record<string, boolean> = {}
                    get().allPosts.forEach((post) => {
                        existing[post.id] = true
                    })
                    const fresh = posts.filter((post) => !existing[post.id])

                    set({
                        allPosts: get().allPosts.concat(fresh),
                        isPageLoading: false,
                        hasMore: posts.length >= PAGE_SIZE,
                    })
                } catch (error) {
                    console.error(error)
                    set({ isPageLoading: false })
                } finally {
                    inFlight = null
                }
            })()

            return inFlight
        },

        refreshFeed: async () => {
            resetPaging()
            set({ allPosts: [], hasMore: true, feedError: false })
            await get().setAllPosts()
        },

        removePost: (postId: string) => {
            set({ allPosts: get().allPosts.filter((post) => post.id !== postId) })
        },

        patchPost: (postId: string, patch: Partial<PostWithProfile>) => {
            set({
                allPosts: get().allPosts.map((post) =>
                    post.id === postId ? { ...post, ...patch } : post
                ),
            })
        },

        setPostsByUser: async (userId: string) => {
            const result = await fetchUserPosts(userId, 'posts', null)
            set({ postsByUser: result });
        },

        setPostById: async (postId: string) => {
            // Show the copy we already have while the fresh one loads.
            const local = get().allPosts.filter((post) => post.id === postId)[0]
            if (local) set({ postById: local })

            const result = await fetchPost(postId)
            set({ postById: result })
        },
    }))
)
