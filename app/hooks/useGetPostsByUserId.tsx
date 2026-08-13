import { fetchUserPosts } from "../utils/feed"

const useGetPostsByUser = async (userId: string) => {
    return await fetchUserPosts(userId, 'posts', null)
}

export default useGetPostsByUser
