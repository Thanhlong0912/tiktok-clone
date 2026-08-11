import { supabase } from "@/libs/supabase"

const useDeleteLike = async (id: string) => {
    const { error } = await supabase.from('likes').delete().eq('id', id)

    if (error) throw error
}

export default useDeleteLike
