import { create } from 'zustand';
import { persist, devtools, createJSONStorage } from 'zustand/middleware';
import { RandomUsers } from '../types';
import useGetRandomUsers from '../hooks/useGetRandomUsers';

interface GeneralStore {
    isLoginOpen: boolean,
    isEditProfileOpen: boolean,
    /**
     * The feed's comments panel belongs to the feed, not to one card.
     *
     * It used to be local state inside each PostMain, so scrolling to the next
     * video left the panel pinned to the previous card -- still showing the
     * previous video's comments -- while the new card, whose own flag was
     * false, never opened and never fetched anything.
     */
    isFeedCommentsOpen: boolean,
    /**
     * Post id of the feed card currently filling the viewport. Set by whichever
     * card becomes active and never cleared on the way out, so the hand-off
     * between two cards has no gap for the panel to flicker through.
     */
    activeFeedPostId: string | null,
    randomUsers: RandomUsers[]
    setIsLoginOpen: (val: boolean) => void,
    setIsEditProfileOpen: (val: boolean) => void,
    setIsFeedCommentsOpen: (val: boolean) => void,
    setActiveFeedPostId: (postId: string) => void,
    setRandomUsers: () => void,
}

export const useGeneralStore = create<GeneralStore>()(
  devtools(
      persist(
          (set) => ({
              isLoginOpen: false,
              isEditProfileOpen: false,
              isFeedCommentsOpen: false,
              activeFeedPostId: null,
              randomUsers: [],

              setIsLoginOpen: (val: boolean) => set({ isLoginOpen: val }),
              setIsEditProfileOpen: (val: boolean) => set({ isEditProfileOpen: val }),
              setIsFeedCommentsOpen: (val: boolean) => set({ isFeedCommentsOpen: val }),
              setActiveFeedPostId: (postId: string) => set({ activeFeedPostId: postId }),
              setRandomUsers: async () => {
                  const result = await useGetRandomUsers()
                  set({ randomUsers: result })
              },
          }),
          {
              name: 'tt-general',
              storage: createJSONStorage(() => localStorage),
              // Only the cached list is worth persisting. Persisting the modal
              // flags meant a reload could reopen the login sheet on its own.
              partialize: (state) => ({ randomUsers: state.randomUsers }),
          }
      )
  )
)
