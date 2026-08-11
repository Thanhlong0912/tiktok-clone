import { supabase } from "@/libs/supabase"

const useGetPostsByUser = async (userId: string) => {
    const { data, error } = await supabase
        .from('posts')
        .select('id, user_id, video_url, text, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

    if (error) throw error

    return (data ?? []).map(doc => {
        return {
            id: doc?.id,
            user_id: doc?.user_id,
            video_url: doc?.video_url,
            text: doc?.text,
            created_at: doc?.created_at,
        }
    })
}

export default useGetPostsByUser
