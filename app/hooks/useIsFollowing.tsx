import { database, Query } from "@/libs/AppWriteClient";

const useIsFollowing = async (userId: string, toUserId: string) => {
    try {
        const response = await database.listDocuments(
            String(process.env.NEXT_PUBLIC_DATABASE_ID),
            String(process.env.NEXT_PUBLIC_COLLECTION_ID_FOLLOW),
            [
                Query.equal('user_id', userId),
                Query.equal('to_user_id', toUserId)
            ]
        );
        const documents = response.documents;
        return documents[0]?.$id || null
    } catch (error) {
        throw error
    }
}

export default useIsFollowing
