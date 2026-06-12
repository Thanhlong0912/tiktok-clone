export const createBucketUrl = (fileId: string) => {

  const url = process.env.NEXT_PUBLIC_APPWRITE_URL
  const id = process.env.NEXT_PUBLIC_BUCKET_ID
  const endpoint = process.env.NEXT_PUBLIC_ENDPOINT

  if (!url || !id || !endpoint || !fileId) return ''

  return `${url}/storage/buckets/${id}/files/${fileId}/view?project=${endpoint}`
}

const useCreateBucketUrl = createBucketUrl

export default useCreateBucketUrl
