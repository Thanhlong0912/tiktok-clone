import { supabase } from "@/libs/supabase";

const useIsFollowing = async (userId: string, toUserId: string) => {
    const { data, error } = await supabase
        .from('follows')
        .select('id')
        .eq('user_id', userId)
        .eq('to_user_id', toUserId)
        .maybeSingle()

    if (error) throw error

    return data?.id || null
}

export default useIsFollowing
