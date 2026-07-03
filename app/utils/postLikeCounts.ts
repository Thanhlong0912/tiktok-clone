import useGetLikesByPostId from '../hooks/useGetLikesByPostId'

const CACHE_TTL_MS = 60_000

const likeCountCache = new Map<string, { count: number; updatedAt: number }>()
const inFlight = new Map<string, Promise<number>>()

/**
 * Real like count for a post, cached for a minute so grids of thumbnails
 * don't re-query Appwrite on every render.
 */
export async function getPostLikeCount(postId: string): Promise<number> {
  const cached = likeCountCache.get(postId)
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached.count
  }

  const pending = inFlight.get(postId)
  if (pending) {
    return pending
  }

  const request = (async () => {
    try {
      const likes = await useGetLikesByPostId(postId)
      const count = likes?.length || 0
      likeCountCache.set(postId, { count, updatedAt: Date.now() })
      return count
    } finally {
      inFlight.delete(postId)
    }
  })()

  inFlight.set(postId, request)
  return request
}
