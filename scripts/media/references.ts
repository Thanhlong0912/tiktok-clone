import { getPostStorageFileIds } from '@/app/utils/postMedia'

export type PostRow = { video_url: string | null; poster_key?: string | null }
export type ProfileRow = { image: string | null }
export type CaptionRow = { storage_key: string | null }

export const buildReferencedKeys = (
    posts: PostRow[],
    profiles: ProfileRow[],
    placeholderImageId: string,
    captions: CaptionRow[] = []
): Set<string> => {
    if (posts.length === 0 || profiles.length === 0) {
        const empty = posts.length === 0 ? 'posts' : 'profiles'
        throw new Error(
            `The database returned no rows for ${empty}. Refusing to continue, ` +
            'because an incomplete reference set would classify live objects in ' +
            'the bucket as orphans. Check SUPABASE_SERVICE_ROLE_KEY, the project ' +
            'url, and that RLS is not filtering the query.'
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

        // Cover frames are a separate column, not part of video_url. Leaving
        // them out here made every poster older than --min-age look orphaned,
        // so a --delete run would have stripped the covers off the whole feed.
        if (post.poster_key) {
            referenced.add(post.poster_key)
        }
    }

    for (const profile of profiles) {
        if (profile.image) {
            referenced.add(profile.image)
        }
    }

    for (const caption of captions) {
        if (caption.storage_key) {
            referenced.add(caption.storage_key)
        }
    }

    return referenced
}
