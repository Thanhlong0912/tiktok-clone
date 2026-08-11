import { supabase } from "@/libs/supabase"
import useGetProfileByUserId from "./useGetProfileByUserId";

const useGetCommentsByPostId = async (postId: string) => {
    const { data, error } = await supabase
        .from('comments')
        .select('id, user_id, post_id, text, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: false })

    if (error) throw error

    const objPromises = (data ?? []).map(async comment => {
        const profile = await useGetProfileByUserId(comment.user_id)

        return {
            id: comment?.id,
            user_id: comment?.user_id,
            post_id: comment?.post_id,
            text: comment?.text,
            created_at: comment?.created_at,
            profile: {
                user_id: profile?.user_id,
                name: profile?.name,
                image: profile?.image,
            }
        }
    })

    const result = await Promise.all(objPromises)
    return result
}

export default useGetCommentsByPostId
