import { PostWithProfile } from "../types";
import { getInteractionsByUser } from "../utils/socialInteractions";
import useGetPostById from "./useGetPostById";

const useGetSavedPosts = async (userId: string): Promise<PostWithProfile[]> => {
    try {
        const saves = await getInteractionsByUser('save', userId)

        const objPromises = saves.map(async (save) => {
            try {
                const post = await useGetPostById(save.post_id)
                return post as PostWithProfile
            } catch (error) {
                console.warn(`Could not fetch saved post ${save.post_id}:`, error)
                return null
            }
        })

        const result = await Promise.all(objPromises)
        return result.filter((post): post is PostWithProfile => post !== null).reverse()
    } catch (error) {
        console.error("useGetSavedPosts error:", error)
        throw error
    }
}

export default useGetSavedPosts
