import { supabase } from "@/libs/supabase"
import { storage } from "@/libs/storage";
import { getPostStorageFileIds } from "../utils/postMedia";

/**
 * Soft delete. The previous version fetched every like and every comment on the
 * post and deleted them one request at a time -- hundreds of round trips for a
 * popular post, most of which silently failed anyway because RLS only lets the
 * *author* of a comment delete it.
 *
 * Setting deleted_at hides the post from every read path (the RPCs filter it,
 * and the RLS select policy only exposes it to its owner), and the counter
 * trigger adjusts the author's post_count.
 */
const useDeletePostById = async (postId: string, currentMedia: string) => {
    const { error } = await supabase
        .from('posts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', postId)

    if (error) throw error

    // Media is removed eagerly; scripts/media/orphans.ts sweeps anything left
    // behind if this fails.
    await storage.remove(getPostStorageFileIds(currentMedia)).catch(() => {})
}

export default useDeletePostById
