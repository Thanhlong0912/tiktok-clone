import { supabase } from "@/libs/supabase"
import useGetProfileByUserId from "./useGetProfileByUserId";

const useGetPostById = async (id: string) => {
    const { data: post, error } = await supabase
        .from('posts')
        .select('id, user_id, video_url, text, created_at')
        .eq('id', id)
        .single()

    if (error) throw error

    const profile = await useGetProfileByUserId(post?.user_id)

    return {
        id: post?.id,
        user_id: post?.user_id,
        video_url: post?.video_url,
        text: post?.text,
        created_at: post?.created_at,
        profile: {
            user_id: profile?.user_id,
            name: profile?.name,
            image: profile?.image,
        }
    }
}

export default useGetPostById
