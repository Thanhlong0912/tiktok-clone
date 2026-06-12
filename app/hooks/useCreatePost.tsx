import { database, storage, ID } from "@/libs/AppWriteClient"
import { createImagePostValue, createStorageFileId, UploadPostMedia } from "../utils/postMedia"

const useCreatePost = async (media: UploadPostMedia, userId: string, caption: string) => {
    const uploadedFileIds: string[] = []

    try {
        let mediaValue = ''

        if (media.type === 'video') {
            const videoId = createStorageFileId()
            await storage.createFile(String(process.env.NEXT_PUBLIC_BUCKET_ID), videoId, media.file)
            uploadedFileIds.push(videoId)
            mediaValue = videoId
        } else {
            const imageIds = media.files.map(() => createStorageFileId())

            for (let index = 0; index < media.files.length; index += 1) {
                await storage.createFile(String(process.env.NEXT_PUBLIC_BUCKET_ID), imageIds[index], media.files[index])
                uploadedFileIds.push(imageIds[index])
            }

            mediaValue = createImagePostValue(imageIds)
        }

        await database.createDocument(
            String(process.env.NEXT_PUBLIC_DATABASE_ID),
            String(process.env.NEXT_PUBLIC_COLLECTION_ID_POST),
            ID.unique(),
        {
            user_id: userId,
            text: caption,
            video_url: mediaValue,
            created_at: new Date().toISOString(),
        });
    } catch (error) {
        await Promise.allSettled(
            uploadedFileIds.map((fileId) => storage.deleteFile(String(process.env.NEXT_PUBLIC_BUCKET_ID), fileId))
        )
        throw error
    }
}

export default useCreatePost
