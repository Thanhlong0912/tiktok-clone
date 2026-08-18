import { supabase } from "@/libs/supabase"

/**
 * Filters on user_id, NOT id. `profiles.id` is a separate gen_random_uuid()
 * primary key -- every caller here holds an auth user id, and filtering on the
 * wrong one matched zero rows while PostgREST still reported success, so the
 * edit form silently saved nothing.
 *
 * .select() turns that failure mode into a real error: RLS restricts the update
 * to the caller's own row, so an empty result means the row was not found.
 */
const useUpdateProfile = async (userId: string, name: string, bio: string) => {
    const { data, error } = await supabase
        .from('profiles')
        .update({ name: name, bio: bio })
        .eq('user_id', userId)
        .select('user_id')

    if (error) throw error
    if (!data || data.length < 1) throw new Error('Profile not found')
}

export default useUpdateProfile
