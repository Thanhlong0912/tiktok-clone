import { supabase } from "@/libs/supabase"

/**
 * Backed by the pg_trgm GIN index added in 0002. The pre-existing btree on
 * lower(name) could never serve the leading-wildcard ilike this issues, so
 * every search was a sequential scan.
 *
 * Trigram indexes need at least 3 characters to be selective, so anything
 * shorter than 2 short-circuits rather than scanning the table.
 */
const useSearchProfilesByName = async (name: string) => {
    const query = (name ?? '').trim().slice(0, 80)
    if (query.length < 2) return []

    try {
        const { data, error } = await supabase.rpc('search_users', {
            p_query: query,
            p_limit: 8,
        })

        if (error) throw error

        return ((data as any[]) ?? []).map((profile) => ({
            id: profile?.user_id,
            name: profile?.name,
            image: profile?.image,
        }))
    } catch (error) {
        console.log(error)
        return []
    }
}

export default useSearchProfilesByName
