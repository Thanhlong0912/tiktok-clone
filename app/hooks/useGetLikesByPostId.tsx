import { supabase } from "@/libs/supabase"

const useGetLikesByPostId = async (postId: string) => {
    const { data, error } = await supabase
        .from('likes')
        .select('id, user_id, post_id')
        .eq('post_id', postId)

    if (error) throw error

    return (data ?? []).map(doc => {
        return {
            id: doc?.id,
            user_id: doc?.user_id,
            post_id: doc?.post_id
        }
    })
}

export default useGetLikesByPostId
