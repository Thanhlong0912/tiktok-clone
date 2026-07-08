import { PostWithProfile } from "../types";
import { getInteractionsByUser } from "../utils/socialInteractions";
import useGetPostById from "./useGetPostById";

const useGetRepostedPosts = async (userId: string): Promise<PostWithProfile[]> => {
    try {
        const reposts = await getInteractionsByUser('repost', userId)

        const objPromises = reposts.map(async (repost) => {
            try {
                const post = await useGetPostById(repost.post_id)
                return post as PostWithProfile
            } catch (error) {
                console.warn(`Could not fetch reposted post ${repost.post_id}:`, error)
                return null
            }
        })

        const result = await Promise.all(objPromises)
        return result.filter((post): post is PostWithProfile => post !== null).reverse()
    } catch (error) {
        console.error("useGetRepostedPosts error:", error)
        throw error
    }
}

export default useGetRepostedPosts
