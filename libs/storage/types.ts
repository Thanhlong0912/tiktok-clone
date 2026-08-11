export type UploadOptions = {
    onProgress?: (percent: number) => void
    signal?: AbortSignal
}

export interface StorageAdapter {
    upload(key: string, file: File, options?: UploadOptions): Promise<void>
    remove(keys: string[]): Promise<void>
    publicUrl(key: string): string
}
