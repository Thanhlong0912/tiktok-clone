import { getPublicBaseUrl } from '@/libs/storage/config'
import { buildPublicUrl } from '@/libs/storage/publicUrl'

export const createBucketUrl = (fileId: string) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET

  if (!url || !bucket || !fileId) return ''

  return buildPublicUrl(
    getPublicBaseUrl(url, bucket, process.env.NEXT_PUBLIC_MEDIA_BASE_URL),
    fileId
  )
}

const useCreateBucketUrl = createBucketUrl

export default useCreateBucketUrl
