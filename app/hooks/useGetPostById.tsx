import { fetchPost } from "../utils/feed"

/**
 * One RPC: post + author + counters + this viewer's like/save/repost/follow
 * flags. Previously two round trips (post, then its author's profile).
 */
const useGetPostById = async (id: string) => {
    return await fetchPost(id)
}

export default useGetPostById
