import { supabase } from "@/libs/supabase";

const useDeleteFollow = async (id: string) => {
    const { error } = await supabase.from('follows').delete().eq('id', id)

    if (error) throw error
}

export default useDeleteFollow
