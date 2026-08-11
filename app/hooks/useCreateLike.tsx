import { supabase } from "@/libs/supabase"

const useCreateLike = async (userId: string, postId: string) => {
    const { error } = await supabase.from('likes').insert({
        user_id: userId,
        post_id: postId,
    })

    if (error) throw error
}

export default useCreateLike
