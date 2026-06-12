import { database, Query, storage } from "@/libs/AppWriteClient"
import useDeleteComment from "./useDeleteComment";
import useDeleteLike from "./useDeleteLike";
import useGetCommentsByPostId from "./useGetCommentsByPostId";
import useGetLikesByPostId from "./useGetLikesByPostId";
import { getPostStorageFileIds } from "../utils/postMedia";

const useDeletePostById = async (postId: string, currentMedia: string) => {
    try {
        const likes = await useGetLikesByPostId(postId)
        likes.forEach(async like => { await useDeleteLike(like?.id) })

        const comments = await useGetCommentsByPostId(postId)
        comments.forEach(async comment => { await useDeleteComment(comment?.id) })

        await database.deleteDocument(
            String(process.env.NEXT_PUBLIC_DATABASE_ID),
            String(process.env.NEXT_PUBLIC_COLLECTION_ID_POST),
            postId
        );
        await Promise.allSettled(
            getPostStorageFileIds(currentMedia).map((fileId) => (
                storage.deleteFile(String(process.env.NEXT_PUBLIC_BUCKET_ID), fileId)
            ))
        );
    } catch (error) {
        throw error
    }
}

export default useDeletePostById
