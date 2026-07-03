import { database, Query } from "@/libs/AppWriteClient"
import useGetPostsByUser from "./useGetPostsByUserId"
import useGetProfileByUserId from "./useGetProfileByUserId"

export type ActivityType = 'like' | 'comment' | 'follow'

export interface ActivityItem {
    id: string
    type: ActivityType
    createdAt: string
    actor: {
        user_id: string
        name: string
        image: string
    }
    postId?: string
    postUserId?: string
    commentText?: string
}

const MAX_ITEMS = 50

/**
 * Builds a notification feed for a user from the existing Like, Comment and
 * Follow collections: who liked/commented on their posts and who followed
 * them. Timestamps come from Appwrite's built-in $createdAt.
 */
const useGetActivity = async (userId: string): Promise<ActivityItem[]> => {
    const databaseId = String(process.env.NEXT_PUBLIC_DATABASE_ID)
    const myPosts = await useGetPostsByUser(userId)
    const postIds = myPosts.map((post) => post.id)

    const likesPromise = postIds.length > 0
        ? database.listDocuments(databaseId, String(process.env.NEXT_PUBLIC_COLLECTION_ID_LIKE), [
            Query.equal('post_id', postIds),
            Query.orderDesc('$createdAt'),
            Query.limit(MAX_ITEMS),
        ])
        : Promise.resolve({ documents: [] as any[] })

    const commentsPromise = postIds.length > 0
        ? database.listDocuments(databaseId, String(process.env.NEXT_PUBLIC_COLLECTION_ID_COMMENT), [
            Query.equal('post_id', postIds),
            Query.orderDesc('$createdAt'),
            Query.limit(MAX_ITEMS),
        ])
        : Promise.resolve({ documents: [] as any[] })

    const followsPromise = database.listDocuments(databaseId, String(process.env.NEXT_PUBLIC_COLLECTION_ID_FOLLOW), [
        Query.equal('to_user_id', userId),
        Query.orderDesc('$createdAt'),
        Query.limit(MAX_ITEMS),
    ])

    const [likes, comments, follows] = await Promise.all([likesPromise, commentsPromise, followsPromise])

    const rawItems: Array<Omit<ActivityItem, 'actor'> & { actorUserId: string }> = []

    for (const doc of likes.documents) {
        if (doc.user_id === userId) continue
        rawItems.push({
            id: `like_${doc.$id}`,
            type: 'like',
            createdAt: doc.$createdAt,
            actorUserId: doc.user_id,
            postId: doc.post_id,
            postUserId: userId,
        })
    }

    for (const doc of comments.documents) {
        if (doc.user_id === userId) continue
        rawItems.push({
            id: `comment_${doc.$id}`,
            type: 'comment',
            createdAt: doc.$createdAt,
            actorUserId: doc.user_id,
            postId: doc.post_id,
            postUserId: userId,
            commentText: doc.text,
        })
    }

    for (const doc of follows.documents) {
        if (doc.user_id === userId) continue
        rawItems.push({
            id: `follow_${doc.$id}`,
            type: 'follow',
            createdAt: doc.$createdAt,
            actorUserId: doc.user_id,
        })
    }

    rawItems.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const limitedItems = rawItems.slice(0, MAX_ITEMS)

    const actorIds = Array.from(new Set(limitedItems.map((item) => item.actorUserId)))
    const profileEntries = await Promise.all(
        actorIds.map(async (actorId) => {
            try {
                const profile = await useGetProfileByUserId(actorId)
                return [actorId, profile] as const
            } catch {
                return [actorId, null] as const
            }
        })
    )
    const profilesById = new Map(profileEntries)

    return limitedItems
        .map((item) => {
            const profile = profilesById.get(item.actorUserId)
            if (!profile?.user_id) return null
            const { actorUserId, ...rest } = item
            return {
                ...rest,
                actor: {
                    user_id: profile.user_id,
                    name: profile.name,
                    image: profile.image,
                },
            }
        })
        .filter((item): item is ActivityItem => item !== null)
}

export default useGetActivity
