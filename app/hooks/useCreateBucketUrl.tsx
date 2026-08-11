export const createBucketUrl = (fileId: string) => {

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET

  if (!url || !bucket || !fileId) return ''

  return `${url}/storage/v1/object/public/${bucket}/${fileId}`
}

const useCreateBucketUrl = createBucketUrl

export default useCreateBucketUrl
