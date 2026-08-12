import { BUCKET, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/libs/supabase'
import { getProjectRef, getPublicBaseUrl, getRegion, getS3Endpoint } from './config'
import { createSessionCredentialProvider } from './credentials'
import { createS3Adapter } from './s3Adapter'
import type { StorageAdapter, UploadOptions } from './types'

export type { StorageAdapter, UploadOptions } from './types'

let adapter: StorageAdapter | undefined

// Built on first use, not at import. getRegion() throws when
// NEXT_PUBLIC_SUPABASE_REGION is unset, and this module is pulled in
// transitively by read-only surfaces (the post page's comments header) that
// never touch storage -- failing at import took those down, and broke static
// generation, for a config value they do not need.
const getAdapter = (): StorageAdapter => {
    if (!adapter) {
        adapter = createS3Adapter({
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
    }

    return adapter
}

export const storage: StorageAdapter = {
    upload: (key: string, file: File, options?: UploadOptions) =>
        getAdapter().upload(key, file, options),
    remove: (keys: string[]) => getAdapter().remove(keys),
    publicUrl: (key: string) => getAdapter().publicUrl(key),
}
