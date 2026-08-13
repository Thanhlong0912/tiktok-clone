import { create } from 'zustand';
import { persist, devtools, createJSONStorage } from 'zustand/middleware';
import { RandomUsers } from '../types';
import useGetRandomUsers from '../hooks/useGetRandomUsers';

interface GeneralStore {
    isLoginOpen: boolean,
    isEditProfileOpen: boolean,
    randomUsers: RandomUsers[]
    setIsLoginOpen: (val: boolean) => void,
    setIsEditProfileOpen: (val: boolean) => void,
    setRandomUsers: () => void,
}

export const useGeneralStore = create<GeneralStore>()(
  devtools(
      persist(
          (set) => ({
              isLoginOpen: false,
              isEditProfileOpen: false,
              randomUsers: [],

              setIsLoginOpen: (val: boolean) => set({ isLoginOpen: val }),
              setIsEditProfileOpen: (val: boolean) => set({ isEditProfileOpen: val }),
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
