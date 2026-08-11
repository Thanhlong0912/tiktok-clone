import { supabase } from "@/libs/supabase"
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
 * Builds a notification feed for a user from the existing likes, comments and
 * follows tables: who liked/commented on their posts and who followed them.
 */
const useGetActivity = async (userId: string): Promise<ActivityItem[]> => {
    const myPosts = await useGetPostsByUser(userId)
    const postIds = myPosts.map((post) => post.id)

    const emptyResult = { data: [] as any[], error: null }

    const likesPromise = postIds.length > 0
        ? supabase
            .from('likes')
            .select('id, user_id, post_id, created_at')
            .in('post_id', postIds)
            .order('created_at', { ascending: false })
            .limit(MAX_ITEMS)
        : Promise.resolve(emptyResult)

    const commentsPromise = postIds.length > 0
        ? supabase
            .from('comments')
            .select('id, user_id, post_id, text, created_at')
            .in('post_id', postIds)
            .order('created_at', { ascending: false })
            .limit(MAX_ITEMS)
        : Promise.resolve(emptyResult)

    const followsPromise = supabase
        .from('follows')
        .select('id, user_id, to_user_id, created_at')
        .eq('to_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(MAX_ITEMS)

    const [likes, comments, follows] = await Promise.all([likesPromise, commentsPromise, followsPromise])

    if (likes.error) throw likes.error
    if (comments.error) throw comments.error
    if (follows.error) throw follows.error

    const rawItems: Array<Omit<ActivityItem, 'actor'> & { actorUserId: string }> = []

    for (const doc of likes.data ?? []) {
        if (doc.user_id === userId) continue
        rawItems.push({
            id: `like_${doc.id}`,
            type: 'like',
            createdAt: doc.created_at,
            actorUserId: doc.user_id,
            postId: doc.post_id,
            postUserId: userId,
        })
    }

    for (const doc of comments.data ?? []) {
        if (doc.user_id === userId) continue
        rawItems.push({
            id: `comment_${doc.id}`,
            type: 'comment',
            createdAt: doc.created_at,
            actorUserId: doc.user_id,
            postId: doc.post_id,
            postUserId: userId,
            commentText: doc.text,
        })
    }

    for (const doc of follows.data ?? []) {
        if (doc.user_id === userId) continue
        rawItems.push({
            id: `follow_${doc.id}`,
            type: 'follow',
            createdAt: doc.created_at,
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
