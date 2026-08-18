import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Profile } from '../types';
import useGetProfileByUserId from '../hooks/useGetProfileByUserId';

/**
 * Not persisted: a profile cached in localStorage outlives the session it was
 * fetched in, so logging in as somebody else showed the previous account's
 * name and avatar until the next fetch resolved.
 */
interface ProfileStore {
    currentProfile: Profile | null;
    setCurrentProfile: (userId: string) => Promise<void>;
}

export const useProfileStore = create<ProfileStore>()(
    devtools((set) => ({
        currentProfile: null,

        setCurrentProfile: async (userId: string) => {
            const result = await useGetProfileByUserId(userId)
            set({ currentProfile: result });
        },
    }))
)
