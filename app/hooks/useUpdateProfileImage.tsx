import { supabase } from "@/libs/supabase"

/** Same user_id / id distinction as useUpdateProfile -- see the note there. */
const useUpdateProfileImage = async (userId: string, image: string) => {
    const { data, error } = await supabase
        .from('profiles')
        .update({ image: image })
        .eq('user_id', userId)
        .select('user_id')

    if (error) throw error
    if (!data || data.length < 1) throw new Error('Profile not found')
}

export default useUpdateProfileImage
