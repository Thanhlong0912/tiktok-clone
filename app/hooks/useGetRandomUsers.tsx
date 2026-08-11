import { supabase } from "@/libs/supabase"

const useGetRandomUsers = async () => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('user_id, name, image')
            .limit(5)

        if (error) throw error

        return (data ?? []).map(profile => {
            return {
                id: profile?.user_id,
                name: profile?.name,
                image: profile?.image,
            }
        })
    } catch (error) {
        console.log(error)
    }
}

export default useGetRandomUsers
