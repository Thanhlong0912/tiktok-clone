import { supabase } from "@/libs/supabase"
import { deleteFiles, uploadFileWithProgress } from "@/libs/uploadWithProgress"
import { createImagePostValue, createStorageFileId, UploadPostMedia } from "../utils/postMedia"

const useCreatePost = async (
    media: UploadPostMedia,
    userId: string,
    caption: string,
    onProgress?: (percent: number) => void
) => {
    const uploadedFileIds: string[] = []

    const totalFiles = media.type === 'video'
        ? 1
        : media.files.length + (media.audioFile ? 1 : 0)
    let completedFiles = 0

    const uploadFile = async (fileId: string, file: File) => {
        await uploadFileWithProgress(fileId, file, (percent) => {
            onProgress?.(Math.round(((completedFiles + percent / 100) / totalFiles) * 100))
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

        const { error } = await supabase.from('posts').insert({
            user_id: userId,
            text: caption,
            video_url: mediaValue,
        })

        if (error) throw error
    } catch (error) {
        await deleteFiles(uploadedFileIds).catch(() => {})
        throw error
    }
}

export default useCreatePost
