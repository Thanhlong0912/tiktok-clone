import { database, Query } from "@/libs/AppWriteClient";

const useGetFollowing = async (userId: string) => {
    try {
        const response = await database.listDocuments(
            String(process.env.NEXT_PUBLIC_DATABASE_ID),
            String(process.env.NEXT_PUBLIC_COLLECTION_ID_FOLLOW),
            [
                Query.equal('user_id', userId)
            ]
        );
        const documents = response.documents;
        return documents;
    } catch (error) {
        throw error
    }
}

export default useGetFollowing
