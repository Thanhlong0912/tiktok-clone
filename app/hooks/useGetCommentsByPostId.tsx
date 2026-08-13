import { supabase } from "@/libs/supabase"

/**
 * A single embedded select. This used to issue one profiles query PER COMMENT,
 * which was only possible to fix once 0002 added the
 * comments.user_id -> profiles.user_id foreign key that PostgREST needs to
 * resolve the embed.
 */
const useGetCommentsByPostId = async (postId: string) => {
    const { data, error } = await supabase
        .from('comments')
        .select('id, user_id, post_id, text, created_at, profiles!comments_user_id_profiles_fkey(user_id, name, image)')
        .eq('post_id', postId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(100)

    if (error) throw error

    return (data ?? []).map((comment: any) => ({
        id: comment?.id,
        user_id: comment?.user_id,
        post_id: comment?.post_id,
        text: comment?.text,
        created_at: comment?.created_at,
        profile: {
            user_id: comment?.profiles?.user_id ?? comment?.user_id,
            name: comment?.profiles?.name ?? '',
            image: comment?.profiles?.image ?? '',
        },
    }))
}

export default useGetCommentsByPostId
