import { database, Query } from "@/libs/AppWriteClient";
import { PostWithProfile } from "../types";
import useGetPostById from "./useGetPostById";

const useGetLikedPosts = async (userId: string): Promise<PostWithProfile[]> => {
    console.log("useGetLikedPosts called with userId:", userId)
    try {
        const response = await database.listDocuments(
            String(process.env.NEXT_PUBLIC_DATABASE_ID),
            String(process.env.NEXT_PUBLIC_COLLECTION_ID_LIKE),
            [
                Query.equal('user_id', userId),
                Query.orderDesc("$id")
            ]
        );
        const documents = response.documents;
        console.log("Found liked documents:", documents.length)

        const objPromises = documents.map(async doc => {
            try {
                console.log("Fetching post details for post_id:", doc?.post_id)
                let post = await useGetPostById(doc?.post_id)
                return post as PostWithProfile
            } catch (error) {
                console.warn(`Could not fetch post ${doc?.post_id}:`, error)
                return null
            }
        })

        const result = await Promise.all(objPromises)
        const filteredResult = result.filter((post): post is PostWithProfile => post !== null)
        console.log("Retrieved liked posts count:", filteredResult.length)
        return filteredResult
    } catch (error) {
        console.error("useGetLikedPosts error:", error)
        throw error
    }
}

export default useGetLikedPosts
