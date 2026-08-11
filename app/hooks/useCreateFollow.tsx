import { supabase } from "@/libs/supabase";

const useCreateFollow = async (userId: string, toUserId: string) => {
    const { data, error } = await supabase
        .from('follows')
        .insert({ user_id: userId, to_user_id: toUserId })
        .select('id')
        .single()

    if (error) throw error

    return data.id as string
}

export default useCreateFollow
