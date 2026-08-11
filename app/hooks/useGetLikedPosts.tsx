import { supabase } from "@/libs/supabase";
import { PostWithProfile } from "../types";
import useGetPostById from "./useGetPostById";

const useGetLikedPosts = async (userId: string): Promise<PostWithProfile[]> => {
    try {
        const { data, error } = await supabase
            .from('likes')
            .select('id, user_id, post_id')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })

        if (error) throw error

        const objPromises = (data ?? []).map(async doc => {
            try {
                let post = await useGetPostById(doc?.post_id)
                return post as PostWithProfile
            } catch (error) {
                console.warn(`Could not fetch post ${doc?.post_id}:`, error)
                return null
            }
        })

        const result = await Promise.all(objPromises)
        return result.filter((post): post is PostWithProfile => post !== null)
    } catch (error) {
        console.error("useGetLikedPosts error:", error)
        throw error
    }
}

export default useGetLikedPosts
