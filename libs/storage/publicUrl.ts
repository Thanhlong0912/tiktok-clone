export const buildPublicUrl = (baseUrl: string, key: string): string => {
    if (!baseUrl || !key) {
        return ''
    }

    // Encoded per segment, not as a whole: keys are foldered (video/, image/,
    // music/, avatar/) and encodeURIComponent would turn the separator into
    // %2F, which resolves to a different object and breaks every rendered
    // image and video.
    const path = key.split('/').map(encodeURIComponent).join('/')

    return `${baseUrl}/${path}`
}
