import { getPostStorageFileIds } from '@/app/utils/postMedia'

export type PostRow = { video_url: string | null }
export type ProfileRow = { image: string | null }

export const buildReferencedKeys = (
    posts: PostRow[],
    profiles: ProfileRow[],
    placeholderImageId: string
): Set<string> => {
    if (posts.length === 0 && profiles.length === 0) {
        throw new Error(
            'The database returned no rows for posts or profiles. Refusing to ' +
            'continue, because an empty reference set would classify every ' +
            'object in the bucket as an orphan. Check SUPABASE_SERVICE_ROLE_KEY ' +
            'and the project url.'
        )
    }

    const referenced = new Set<string>()

    if (placeholderImageId) {
        referenced.add(placeholderImageId)
    }

    for (const post of posts) {
        for (const fileId of getPostStorageFileIds(post.video_url)) {
            referenced.add(fileId)
        }
    }

    for (const profile of profiles) {
        if (profile.image) {
            referenced.add(profile.image)
        }
    }

    return referenced
}
