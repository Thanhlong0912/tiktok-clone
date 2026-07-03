import { database, storage, ID } from "@/libs/AppWriteClient"
import { createImagePostValue, createStorageFileId, UploadPostMedia } from "../utils/postMedia"

const useCreatePost = async (
    media: UploadPostMedia,
    userId: string,
    caption: string,
    onProgress?: (percent: number) => void
) => {
    const uploadedFileIds: string[] = []
    const bucketId = String(process.env.NEXT_PUBLIC_BUCKET_ID)

    const totalFiles = media.type === 'video'
        ? 1
        : media.files.length + (media.audioFile ? 1 : 0)
    let completedFiles = 0

    const uploadFile = async (fileId: string, file: File) => {
        await storage.createFile(bucketId, fileId, file, undefined, (progress) => {
            onProgress?.(Math.round(((completedFiles + progress.progress / 100) / totalFiles) * 100))
        })
        completedFiles += 1
        onProgress?.(Math.round((completedFiles / totalFiles) * 100))
        uploadedFileIds.push(fileId)
    }

    try {
        let mediaValue = ''

        if (media.type === 'video') {
            const videoId = createStorageFileId()
            await uploadFile(videoId, media.file)
            mediaValue = videoId
        } else {
            const imageIds = media.files.map(() => createStorageFileId())

            for (let index = 0; index < media.files.length; index += 1) {
                await uploadFile(imageIds[index], media.files[index])
            }

            let audioId = ''
            if (media.audioFile) {
                audioId = createStorageFileId()
                await uploadFile(audioId, media.audioFile)
            }

            mediaValue = createImagePostValue(imageIds, audioId)
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
