import { supabase } from "@/libs/supabase"

const useCreateComment = async (userId: string, postId: string, comment: string) => {
    const { error } = await supabase.from('comments').insert({
        user_id: userId,
        post_id: postId,
        text: comment,
    })

    if (error) throw error
}

export default useCreateComment
