import { fetchProfile } from "../utils/feed"

/**
 * Profile plus follower/following/post counts, total likes, and whether the
 * viewer follows or has blocked them -- one call. The profile page previously
 * needed four round trips for this, one of which issued a likes query PER POST
 * just to sum the like total.
 */
const useGetProfileByUserId = async (userId: string) => {
    const profile = await fetchProfile(userId)

    if (!profile) {
        return { id: '', user_id: '', name: '', image: '', bio: '' }
    }

    return {
        id: profile.user_id,
        user_id: profile.user_id,
        name: profile.name,
        image: profile.image,
        bio: profile.bio,
    }
}

export default useGetProfileByUserId
