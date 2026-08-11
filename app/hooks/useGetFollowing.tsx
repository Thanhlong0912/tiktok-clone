import { supabase } from "@/libs/supabase";

const useGetFollowing = async (userId: string) => {
    const { data, error } = await supabase
        .from('follows')
        .select('id, user_id, to_user_id')
        .eq('user_id', userId)

    if (error) throw error

    return data ?? []
}

export default useGetFollowing
