import { supabase } from "@/libs/supabase"
import { deleteFiles } from "@/libs/uploadWithProgress";
import useDeleteComment from "./useDeleteComment";
import useDeleteLike from "./useDeleteLike";
import useGetCommentsByPostId from "./useGetCommentsByPostId";
import useGetLikesByPostId from "./useGetLikesByPostId";
import { getPostStorageFileIds } from "../utils/postMedia";

const useDeletePostById = async (postId: string, currentMedia: string) => {
    const likes = await useGetLikesByPostId(postId)
    await Promise.allSettled(likes.map(like => useDeleteLike(like?.id)))

    const comments = await useGetCommentsByPostId(postId)
    await Promise.allSettled(comments.map(comment => useDeleteComment(comment?.id)))

    const { error } = await supabase.from('posts').delete().eq('id', postId)

    if (error) throw error

    await deleteFiles(getPostStorageFileIds(currentMedia)).catch(() => {})
}

export default useDeletePostById
