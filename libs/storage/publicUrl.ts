export const buildPublicUrl = (baseUrl: string, key: string): string => {
    if (!baseUrl || !key) {
        return ''
    }

    return `${baseUrl}/${encodeURIComponent(key)}`
}
