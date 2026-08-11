import { supabase } from "@/libs/supabase";
import useGetProfileByUserId from "./useGetProfileByUserId";

const useGetAllPosts = async () => {
    const { data, error } = await supabase
        .from('posts')
        .select('id, user_id, video_url, text, created_at')
        .order('created_at', { ascending: false })
        .limit(100)

    if (error) throw error

    const objPromises = (data ?? []).map(async doc => {
        let profile = await useGetProfileByUserId(doc?.user_id)

        return {
            id: doc?.id,
            user_id: doc?.user_id,
            video_url: doc?.video_url,
            text: doc?.text,
            created_at: doc?.created_at,
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

export default useGetAllPosts
