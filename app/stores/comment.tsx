import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { CommentWithProfile } from '../types';
import useGetCommentsByPostId from '../hooks/useGetCommentsByPostId';

/**
 * Deliberately NOT persisted, for the same reason the feed store is not:
 * writing this list to localStorage meant opening any post first rendered the
 * comments of whatever post was open last session, until the real fetch landed.
 * A stale comment thread under the wrong video is worse than an empty one for
 * 200ms.
 */
interface CommentStore {
    commentsByPost: CommentWithProfile[]
    setCommentsByPost: (postId: string) => Promise<void>;
    clearComments: () => void;
}

export const useCommentStore = create<CommentStore>()(
    devtools((set) => ({
        commentsByPost: [],

        setCommentsByPost: async (postId: string) => {
            const result = await useGetCommentsByPostId(postId)
            set({ commentsByPost: result });
        },

        clearComments: () => set({ commentsByPost: [] }),
    }))
)
