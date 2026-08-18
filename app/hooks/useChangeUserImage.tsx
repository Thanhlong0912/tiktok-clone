import { storage } from "@/libs/storage"
import { createStorageKey } from "../utils/postMedia";
import Image from "image-js";

/**
 * Crops, resizes and uploads a new avatar, returning its storage key.
 *
 * Deleting the OLD avatar is deliberately not done here. It used to be, which
 * meant the previous file was gone before the profile row had been updated to
 * point at the new one -- and when that update silently failed, the profile was
 * left referencing an object that no longer existed. The caller now removes the
 * old file only after the row has actually been written, via
 * deletePreviousAvatar below.
 */
const useChangeUserImage = async (file: File, cropper: any, _currentImage?: string) => {
    let imageId = createStorageKey('avatar')

    const x = cropper.left;
    const y = cropper.top;
    const width = cropper.width;
    const height = cropper.height;

    const objectUrl = URL.createObjectURL(file)
    try {
        const response = await fetch(objectUrl);
        const imageBuffer = await response.arrayBuffer();

        const image = await Image.load(imageBuffer)
        const croppedImage = image.crop({ x, y, width, height });
        const resizedImage = croppedImage.resize({ width: 200, height: 200 });
        const blob = await resizedImage.toBlob();
        const arrayBuffer = await blob.arrayBuffer();
        const finalFile = new File([arrayBuffer], file.name, { type: blob.type });

        await storage.upload(imageId, finalFile)
    } finally {
        // The object url leaked on every avatar change before this.
        URL.revokeObjectURL(objectUrl)
    }

    return imageId
}

/**
 * Best-effort cleanup of the avatar a profile just stopped using.
 *
 * Never throws: the profile is already updated by the time this runs, and
 * scripts/media/orphans.ts sweeps anything left behind.
 *
 * Skipped entirely when the placeholder id is unconfigured. `placeholder-avatar
 * .png` is shared by every account that has not picked a picture, so deleting it
 * breaks the default avatar for everyone at once -- and with the env var unset
 * there is no way to recognise it.
 */
export const deletePreviousAvatar = async (currentImage?: string) => {
    const placeholder = process.env.NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID

    if (!currentImage || !placeholder || currentImage === placeholder) {
        return
    }

    await storage.remove([currentImage]).catch(() => {})
}

export default useChangeUserImage
