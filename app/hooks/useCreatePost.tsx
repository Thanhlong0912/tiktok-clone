import { supabase } from "@/libs/supabase"
import { storage } from "@/libs/storage"
import { createImagePostValue, createStorageKey, UploadPostMedia } from "../utils/postMedia"
import type { VideoMetadata } from "../utils/posterFrame"

interface CreatePostExtras {
    /** Cover frame captured in the browser. Optional -- a post without one
     *  still works, its thumbnails just have to decode video to paint. */
    poster?: File | null
    metadata?: VideoMetadata | null
    /** Optional .vtt subtitle track, validated in the upload page. */
    captions?: File | null
}

const useCreatePost = async (
    media: UploadPostMedia,
    userId: string,
    caption: string,
    onProgress?: (percent: number) => void,
    extras?: CreatePostExtras
) => {
    const uploadedFileIds: string[] = []
    let isPostCreated = false
    let postId = ''
    let captionsAttached = true

    const totalFiles = (media.type === 'video'
        ? 1
        : media.files.length + (media.audioFile ? 1 : 0))
        + (extras?.poster ? 1 : 0)
        + (extras?.captions ? 1 : 0)
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

        let captionsKey = ''
        if (extras?.captions) {
            captionsKey = createStorageKey('caption')
            await uploadFile(captionsKey, extras.captions)
        }

        // .select() so the caption row below can reference the new post; the
        // insert is otherwise unchanged.
        const { data: created, error } = await supabase
            .from('posts')
            .insert({
                user_id: userId,
                text: caption,
                video_url: mediaValue,
                poster_key: posterKey,
                duration_ms: extras?.metadata?.durationMs ?? null,
                width: extras?.metadata?.width ?? null,
                height: extras?.metadata?.height ?? null,
            })
            .select('id')
            .single()

        if (error) throw error

        // Past this line the post is live and its media MUST NOT be swept up by
        // the rollback below -- that would leave a row pointing at deleted
        // objects, which is worse than any failure after this point.
        isPostCreated = true
        postId = created?.id ?? ''

        if (captionsKey && postId) {
            const { error: captionsError } = await supabase.from('post_captions').insert({
                post_id: postId,
                user_id: userId,
                lang: 'en',
                label: 'English',
                storage_key: captionsKey,
            })

            // Reported, not thrown: the video is what the creator came to post,
            // and it is already up. The upload page surfaces this as a warning
            // and still navigates to the new post.
            if (captionsError) {
                console.error('post_captions insert failed', captionsError)
                await storage.remove([captionsKey]).catch(() => {})
                captionsAttached = false
            }
        }
    } catch (error) {
        if (!isPostCreated) {
            await storage.remove(uploadedFileIds).catch(() => {})
        }
        throw error
    }

    return { postId, captionsAttached }
}

export default useCreatePost
