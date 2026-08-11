import { BUCKET, SUPABASE_URL, supabase } from './supabase'

/**
 * Uploads a file to Supabase Storage with byte level progress reporting.
 *
 * supabase-js uses fetch under the hood and exposes no progress callback, so
 * we talk to the storage REST endpoint directly through XMLHttpRequest, which
 * does report upload progress.
 */
export const uploadFileWithProgress = (
    path: string,
    file: File,
    onProgress?: (percent: number) => void
) => {
    return new Promise<void>(async (resolve, reject) => {
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
            reject(new Error('You must be logged in to upload files'))
            return
        }

        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`)
        xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
        xhr.setRequestHeader('apikey', String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))
        xhr.setRequestHeader('x-upsert', 'false')
        if (file.type) xhr.setRequestHeader('Content-Type', file.type)

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return
            onProgress?.((event.loaded / event.total) * 100)
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                onProgress?.(100)
                resolve()
                return
            }

            let message = `Upload failed with status ${xhr.status}`
            try {
                const body = JSON.parse(xhr.responseText)
                message = body?.message || body?.error || message
            } catch {
                // response was not json, keep the generic message
            }
            reject(new Error(message))
        }

        xhr.onerror = () => reject(new Error('Upload failed: network error'))
        xhr.onabort = () => reject(new Error('Upload aborted'))

        xhr.send(file)
    })
}

export const deleteFiles = async (paths: string[]) => {
    if (paths.length === 0) return
    const { error } = await supabase.storage.from(BUCKET).remove(paths)
    if (error) throw error
}
