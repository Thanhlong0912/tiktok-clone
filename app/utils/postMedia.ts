export const IMAGE_POST_PREFIX = 'images:'
export const IMAGE_AUDIO_SEPARATOR = '|audio:'
export const MAX_IMAGE_UPLOAD_COUNT = 10
export const IMAGE_SLIDE_DURATION_MS = 3000

export type UploadPostMedia =
  | { type: 'video'; file: File }
  | { type: 'images'; files: File[]; audioFile?: File | null }

export const createStorageFileId = () => Math.random().toString(36).slice(2, 22)

export const isImagePost = (mediaValue?: string | null) => {
  return Boolean(mediaValue?.startsWith(IMAGE_POST_PREFIX))
}

export const createImagePostValue = (imageIds: string[], audioId?: string | null) => {
  const base = `${IMAGE_POST_PREFIX}${imageIds.join(',')}`

  if (!audioId) {
    return base
  }

  return `${base}${IMAGE_AUDIO_SEPARATOR}${audioId}`
}

export const getImagePostIds = (mediaValue?: string | null) => {
  if (!mediaValue || !isImagePost(mediaValue)) {
    return []
  }

  return mediaValue
    .slice(IMAGE_POST_PREFIX.length)
    .split(IMAGE_AUDIO_SEPARATOR)[0]
    .split(',')
    .map((imageId) => imageId.trim())
    .filter(Boolean)
}

export const getImagePostAudioId = (mediaValue?: string | null) => {
  if (!mediaValue || !isImagePost(mediaValue)) {
    return ''
  }

  const separatorIndex = mediaValue.indexOf(IMAGE_AUDIO_SEPARATOR)
  if (separatorIndex === -1) {
    return ''
  }

  return mediaValue.slice(separatorIndex + IMAGE_AUDIO_SEPARATOR.length).trim()
}

export const getPostStorageFileIds = (mediaValue?: string | null) => {
  if (!mediaValue) {
    return []
  }

  if (isImagePost(mediaValue)) {
    const audioId = getImagePostAudioId(mediaValue)
    return audioId ? [...getImagePostIds(mediaValue), audioId] : getImagePostIds(mediaValue)
  }

  return [mediaValue]
}
