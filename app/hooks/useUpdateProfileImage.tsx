import { supabase } from "@/libs/supabase"

const useUpdateProfileImage = async (id: string, image: string) => {
    const { error } = await supabase
        .from('profiles')
        .update({ image: image })
        .eq('id', id)

    if (error) throw error
}

export default useUpdateProfileImage
