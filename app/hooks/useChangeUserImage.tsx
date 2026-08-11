import { BUCKET, supabase } from "@/libs/supabase"
import { createStorageFileId } from "../utils/postMedia";
import Image from "image-js";

const useChangeUserImage = async (file: File, cropper: any, currentImage: string) => {
    let imageId = createStorageFileId()

    const x = cropper.left;
    const y = cropper.top;
    const width = cropper.width;
    const height = cropper.height;

    const response = await fetch(URL.createObjectURL(file));
    const imageBuffer = await response.arrayBuffer();

    const image = await Image.load(imageBuffer)
    const croppedImage = image.crop({ x, y, width, height });
    const resizedImage = croppedImage.resize({ width: 200, height: 200 });
    const blob = await resizedImage.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    const finalFile = new File([arrayBuffer], file.name, { type: blob.type });

    const { error } = await supabase.storage.from(BUCKET).upload(imageId, finalFile, {
        contentType: finalFile.type,
    })

    if (error) throw error

    // if current image is not default image delete
    if (currentImage != String(process.env.NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID)) {
        await supabase.storage.from(BUCKET).remove([currentImage]);
    }

    return imageId
}

export default useChangeUserImage
