import { supabase } from "@/libs/supabase"

const useUpdateProfile = async (id: string, name: string, bio: string) => {
    const { error } = await supabase
        .from('profiles')
        .update({ name: name, bio: bio })
        .eq('id', id)

    if (error) throw error
}

export default useUpdateProfile
