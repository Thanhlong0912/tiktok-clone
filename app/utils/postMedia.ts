export const IMAGE_POST_PREFIX = 'images:'
export const MAX_IMAGE_UPLOAD_COUNT = 10
export const IMAGE_SLIDE_DURATION_MS = 3000

export type UploadPostMedia =
  | { type: 'video'; file: File }
  | { type: 'images'; files: File[] }

export const createStorageFileId = () => Math.random().toString(36).slice(2, 22)

export const isImagePost = (mediaValue?: string | null) => {
  return Boolean(mediaValue?.startsWith(IMAGE_POST_PREFIX))
}

export const createImagePostValue = (imageIds: string[]) => {
  return `${IMAGE_POST_PREFIX}${imageIds.join(',')}`
}

export const getImagePostIds = (mediaValue?: string | null) => {
  if (!mediaValue || !isImagePost(mediaValue)) {
    return []
  }

  return mediaValue
    .slice(IMAGE_POST_PREFIX.length)
    .split(',')
    .map((imageId) => imageId.trim())
    .filter(Boolean)
}

export const getPostStorageFileIds = (mediaValue?: string | null) => {
  if (!mediaValue) {
    return []
  }

  if (isImagePost(mediaValue)) {
    return getImagePostIds(mediaValue)
  }

  return [mediaValue]
}
