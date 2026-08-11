import { supabase } from "@/libs/supabase"

const useGetProfileByUserId = async (userId: string) => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, name, image, bio')
        .eq('user_id', userId)
        .maybeSingle()

    if (error) throw error

    return {
        id: data?.id,
        user_id: data?.user_id,
        name: data?.name,
        image: data?.image,
        bio: data?.bio
    }
}

export default useGetProfileByUserId
