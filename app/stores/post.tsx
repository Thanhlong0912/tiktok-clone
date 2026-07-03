import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import useGetAllPosts from '../hooks/useGetAllPosts';
import useGetPostById from '../hooks/useGetPostById';
import useGetPostsByUser from '../hooks/useGetPostsByUserId';
import { Post, PostWithProfile } from '../types';

interface PostStore {
    allPosts: PostWithProfile[];
    postsByUser: Post[];
    postById: PostWithProfile | null;
    isFeedLoading: boolean;
    feedError: boolean;
    setAllPosts: () => void;
    setPostsByUser: (userId: string) => void;
    setPostById: (postId: string) => void;
}

export const usePostStore = create<PostStore>()(
    devtools(
        persist(
            (set) => ({
                allPosts: [],
                postsByUser: [],
                postById: null,
                isFeedLoading: false,
                feedError: false,

                setAllPosts: async () => {
                    set({ isFeedLoading: true, feedError: false });
                    try {
                        const result = await useGetAllPosts()
                        set({ allPosts: result, isFeedLoading: false });
                    } catch (error) {
                        console.error(error)
                        set({ isFeedLoading: false, feedError: true });
                    }
                },
                setPostsByUser: async (userId: string) => {
                    const result = await useGetPostsByUser(userId)
                    set({ postsByUser: result });
                },
                setPostById: async (postId: string) => {
                    // Try to find locally first for immediate UI update
                    const { allPosts, postsByUser } = usePostStore.getState();
                    let localPost = allPosts.find((p) => p.id === postId) as PostWithProfile || 
                                    postsByUser.find((p) => Number(p.id) === Number(postId)) as unknown as PostWithProfile;
                    
                    if (localPost) {
                        set({ postById: localPost });
                    }

                    const result = await useGetPostById(postId)
                    set({ postById: result })
                },
            }),
            {
                name: 'store',
                storage: createJSONStorage(() => localStorage),
                partialize: (state) => ({
                    allPosts: state.allPosts,
                    postsByUser: state.postsByUser,
                    postById: state.postById,
                }),
            }
        )
    )
)
