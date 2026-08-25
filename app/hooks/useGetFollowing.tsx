import { supabase } from "@/libs/supabase";
import { RandomUsers } from "../types";

/**
 * Accounts this user follows, as renderable profiles.
 *
 * The sidebar's "Following accounts" section used to render the SAME trending
 * creators array as "Suggested accounts" directly above it, so it showed
 * strangers under a label promising the opposite.
 *
 * Two queries rather than a PostgREST embed: follows.to_user_id references
 * auth.users, not public.profiles, so there is no foreign key for an embed to
 * traverse. Both are capped, so this stays two small round trips.
 */
const useGetFollowing = async (userId: string, limit = 5): Promise<RandomUsers[]> => {
    if (!userId) return []

    try {
        const { data: follows, error: followsError } = await supabase
            .from('follows')
            .select('to_user_id')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit)

        if (followsError) throw followsError

        const ids = (follows ?? []).map((row: any) => row.to_user_id).filter(Boolean)
        if (ids.length < 1) return []

        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('user_id, name, image, handle')
            .in('user_id', ids)

        if (profilesError) throw profilesError

        // Re-ordered to match the follow order, which .in() does not preserve.
        const byId = new Map((profiles ?? []).map((profile: any) => [profile.user_id, profile]))

        return ids
            .map((id: string) => byId.get(id))
            .filter(Boolean)
            .map((profile: any) => ({
                id: profile.user_id,
                name: profile.name,
                image: profile.image,
                handle: profile.handle ?? '',
            }))
    } catch (error) {
        console.error(error)
        return []
    }
}

export default useGetFollowing
