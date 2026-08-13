import { supabase } from "@/libs/supabase"
import { storage } from "@/libs/storage"
import { createImagePostValue, createStorageKey, UploadPostMedia } from "../utils/postMedia"
import type { VideoMetadata } from "../utils/posterFrame"

interface CreatePostExtras {
    /** Cover frame captured in the browser. Optional -- a post without one
     *  still works, its thumbnails just have to decode video to paint. */
    poster?: File | null
    metadata?: VideoMetadata | null
}

const useCreatePost = async (
    media: UploadPostMedia,
    userId: string,
    caption: string,
    onProgress?: (percent: number) => void,
    extras?: CreatePostExtras
) => {
    const uploadedFileIds: string[] = []

    const totalFiles = (media.type === 'video'
        ? 1
        : media.files.length + (media.audioFile ? 1 : 0)) + (extras?.poster ? 1 : 0)
    let completedFiles = 0

    const uploadFile = async (fileId: string, file: File) => {
        await storage.upload(fileId, file, {
            onProgress: (percent) => {
                onProgress?.(Math.round(((completedFiles + percent / 100) / totalFiles) * 100))
            },
        })
        completedFiles += 1
        onProgress?.(Math.round((completedFiles / totalFiles) * 100))
        uploadedFileIds.push(fileId)
    }

    try {
        let mediaValue = ''
        let posterKey = ''

        if (media.type === 'video') {
            const videoId = createStorageKey('video')
            await uploadFile(videoId, media.file)
            mediaValue = videoId
        } else {
            const imageIds = media.files.map(() => createStorageKey('image'))

            for (let index = 0; index < media.files.length; index += 1) {
                await uploadFile(imageIds[index], media.files[index])
            }

            let audioId = ''
            if (media.audioFile) {
                audioId = createStorageKey('music')
                await uploadFile(audioId, media.audioFile)
            }

            mediaValue = createImagePostValue(imageIds, audioId)
        }

        // Posters live under the image prefix -- they are images, and
        // scripts/media/orphans.ts already sweeps that folder.
        if (extras?.poster) {
            posterKey = createStorageKey('image')
            await uploadFile(posterKey, extras.poster)
        }

        const { error } = await supabase.from('posts').insert({
            user_id: userId,
            text: caption,
            video_url: mediaValue,
            poster_key: posterKey,
            duration_ms: extras?.metadata?.durationMs ?? null,
            width: extras?.metadata?.width ?? null,
            height: extras?.metadata?.height ?? null,
        })

        if (error) throw error
    } catch (error) {
        await storage.remove(uploadedFileIds).catch(() => {})
        throw error
    }
}

export default useCreatePost
