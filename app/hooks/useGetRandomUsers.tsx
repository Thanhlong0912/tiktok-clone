import { fetchTrendingCreators } from "../utils/feed"

/**
 * Suggested accounts. The old implementation selected the first five rows in
 * physical table order and called it random; this ranks by recent engagement
 * and excludes people you have blocked or already are.
 */
const useGetRandomUsers = async () => {
    try {
        const creators = await fetchTrendingCreators(5)

        return creators.map((creator) => ({
            id: creator.user_id,
            name: creator.name,
            image: creator.image,
        }))
    } catch (error) {
        console.log(error)
        return []
    }
}

export default useGetRandomUsers
