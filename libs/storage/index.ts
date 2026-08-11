import { BUCKET, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/libs/supabase'
import { getProjectRef, getPublicBaseUrl, getRegion, getS3Endpoint } from './config'
import { createSessionCredentialProvider } from './credentials'
import { createS3Adapter } from './s3Adapter'
import type { StorageAdapter } from './types'

export type { StorageAdapter, UploadOptions } from './types'

export const storage: StorageAdapter = createS3Adapter({
    bucket: BUCKET,
    region: getRegion(),
    endpoint: getS3Endpoint(SUPABASE_URL),
    publicBaseUrl: getPublicBaseUrl(
        SUPABASE_URL,
        BUCKET,
        process.env.NEXT_PUBLIC_MEDIA_BASE_URL
    ),
    credentials: createSessionCredentialProvider({
        projectRef: getProjectRef(SUPABASE_URL),
        anonKey: SUPABASE_ANON_KEY,
        getSession: () => supabase.auth.getSession(),
    }),
})
