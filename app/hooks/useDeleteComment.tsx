import { supabase } from "@/libs/supabase"

const useDeleteComment = async (id: string) => {
    const { error } = await supabase.from('comments').delete().eq('id', id)

    if (error) throw error
}

export default useDeleteComment
