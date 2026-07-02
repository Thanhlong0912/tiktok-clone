"use client"

import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { AiOutlineCheckCircle } from "react-icons/ai"
import { BiImageAdd, BiLoaderCircle, BiSolidCloudUpload, BiVideoPlus } from "react-icons/bi"
import { ImMusic } from "react-icons/im"
import { PiKnifeLight } from 'react-icons/pi'
import ImageSlideshow from '../components/ImageSlideshow'
import { useUser } from '../context/user'
import useCreatePost from '../hooks/useCreatePost'
import UploadLayout from '../layouts/UploadLayout'
import { UploadError } from '../types'
import { MAX_IMAGE_UPLOAD_COUNT, UploadPostMedia } from '../utils/postMedia'

type UploadMode = 'video' | 'images'

const Upload = () => {
    const contextUser = useUser()
    const router = useRouter()

    let [uploadMode, setUploadMode] = useState<UploadMode>('video');
    let [videoDisplay, setVideoDisplay] = useState<string>('');
    let [imageDisplays, setImageDisplays] = useState<string[]>([]);
    let [caption, setCaption] = useState<string>('');
    let [videoFile, setVideoFile] = useState<File | null>(null);
    let [imageFiles, setImageFiles] = useState<File[]>([]);
    let [audioFile, setAudioFile] = useState<File | null>(null);
    let [audioDisplay, setAudioDisplay] = useState<string>('');
    let [error, setError] = useState<UploadError | null>(null);
    let [isUploading, setIsUploading] = useState<boolean>(false);

    useEffect(() => {
        if (!contextUser?.user) router.push('/')
    }, [contextUser, router])

    useEffect(() => {
        return () => {
            if (videoDisplay) {
                URL.revokeObjectURL(videoDisplay)
            }
        }
    }, [videoDisplay])

    useEffect(() => {
        return () => {
            imageDisplays.forEach((imageUrl) => URL.revokeObjectURL(imageUrl))
        }
    }, [imageDisplays])

    useEffect(() => {
        return () => {
            if (audioDisplay) {
                URL.revokeObjectURL(audioDisplay)
            }
        }
    }, [audioDisplay])

    const onVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;

        if (files && files.length > 0) {
            const file = files[0];
            const fileUrl = URL.createObjectURL(file);
            setVideoDisplay(fileUrl);
            setVideoFile(file);
            setError(null)
        }

        event.target.value = ''
    }

    const onImagesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(event.target.files || [])

        if (selectedFiles.length < 1) {
            event.target.value = ''
            return
        }

        if (selectedFiles.length > MAX_IMAGE_UPLOAD_COUNT) {
            setError({ type: 'File', message: `You can upload up to ${MAX_IMAGE_UPLOAD_COUNT} images` })
            event.target.value = ''
            return
        }

        const validImages = selectedFiles.filter((file) => file.type.startsWith('image/'))
        if (validImages.length !== selectedFiles.length) {
            setError({ type: 'File', message: 'Only image files are supported' })
            event.target.value = ''
            return
        }

        const imageUrls = validImages.map((file) => URL.createObjectURL(file))
        setImageDisplays(imageUrls)
        setImageFiles(validImages)
        setError(null)
        event.target.value = ''
    }

    const onAudioChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files

        if (!files || files.length < 1) {
            event.target.value = ''
            return
        }

        const file = files[0]
        if (!file.type.startsWith('audio/')) {
            setError({ type: 'File', message: 'Only audio files are supported for music' })
            event.target.value = ''
            return
        }

        setAudioDisplay((previous) => {
            if (previous) {
                URL.revokeObjectURL(previous)
            }
            return URL.createObjectURL(file)
        })
        setAudioFile(file)
        setError(null)
        event.target.value = ''
    }

    const discard = () => {
        setVideoDisplay('')
        setVideoFile(null)
        setImageDisplays([])
        setImageFiles([])
        setAudioFile(null)
        setAudioDisplay('')
        setCaption('')
        setError(null)
    }

    const clearVideo = () => {
        setVideoDisplay('')
        setVideoFile(null)
    }

    const clearImages = () => {
        setImageDisplays([])
        setImageFiles([])
    }

    const clearAudio = () => {
        setAudioFile(null)
        setAudioDisplay('')
    }

    const validate = () => {
        setError(null)
        let isError = false

        if (uploadMode === 'video' && !videoFile) {
            setError({ type: 'File', message: 'A video is required'})
            isError = true
        } else if (uploadMode === 'images' && imageFiles.length < 1) {
            setError({ type: 'File', message: 'At least 1 image is required'})
            isError = true
        } else if (uploadMode === 'images' && imageFiles.length > MAX_IMAGE_UPLOAD_COUNT) {
            setError({ type: 'File', message: `You can upload up to ${MAX_IMAGE_UPLOAD_COUNT} images`})
            isError = true
        } else if (!caption.trim()) {
            setError({ type: 'caption', message: 'A caption is required'})
            isError = true
        }
        return isError
    }

    const createNewPost = async () => {
        let isError = validate()
        if (isError) return
        if (!contextUser?.user) return

        const media: UploadPostMedia | null = uploadMode === 'video'
            ? videoFile ? { type: 'video', file: videoFile } : null
            : { type: 'images', files: imageFiles, audioFile }

        if (!media) return
        setIsUploading(true)

        try {
            await useCreatePost(media, contextUser?.user?.id, caption.trim())
            router.push(`/profile/${contextUser?.user?.id}`)
            setIsUploading(false)
        } catch (error) {
            console.log(error)
            setIsUploading(false)
            alert(error)
        }
    }

    const modeTitle = uploadMode === 'video' ? 'Upload video' : 'Upload images'
    const modeSubtitle = uploadMode === 'video'
        ? 'Post a video to your account'
        : 'Post 1 to 10 images in show mode'

  return (
    <>
      <UploadLayout>
            <div className="w-full mt-[80px] mb-[40px] bg-white dark:bg-medium shadow-lg rounded-md py-6 md:px-10 px-4">
                <div>
                    <h1 className="text-[23px] font-semibold dark:text-white">{modeTitle}</h1>
                    <h2 className="text-gray-400 mt-1">{modeSubtitle}</h2>
                </div>

                <div className="mt-6 inline-flex rounded-md border border-gray-200 bg-[#F8F8F8] p-1 dark:border-white/10 dark:bg-dark">
                    <button
                        type="button"
                        onClick={() => {
                            setUploadMode('video')
                            setError(null)
                        }}
                        className={`flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold ${
                            uploadMode === 'video'
                                ? 'bg-white text-[#F02C56] shadow-sm dark:bg-medium'
                                : 'text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                        }`}
                    >
                        <BiVideoPlus size="18" />
                        Video
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setUploadMode('images')
                            setError(null)
                        }}
                        className={`flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold ${
                            uploadMode === 'images'
                                ? 'bg-white text-[#F02C56] shadow-sm dark:bg-medium'
                                : 'text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                        }`}
                    >
                        <BiImageAdd size="18" />
                        Images
                    </button>
                </div>

                <div className="mt-8 md:flex gap-6">

                    {uploadMode === 'video' ? (
                        !videoDisplay ?
                            <label
                                htmlFor="videoInput"
                                className="
                                    md:mx-0
                                    mx-auto
                                    mt-4
                                    mb-6
                                    flex
                                    flex-col
                                    items-center
                                    justify-center
                                    w-full
                                    max-w-[260px]
                                    h-[470px]
                                    text-center
                                    p-3
                                    border-2
                                    border-dashed
                                    border-gray-300
                                    rounded-lg
                                    hover:bg-gray-100
                                    cursor-pointer
                                "
                            >
                                <BiSolidCloudUpload size="40" color="#b3b3b1"/>
                                <p className="mt-4 text-[17px] dark:text-gray-400">Select video to upload</p>
                                <p className="mt-1.5 text-gray-500 text-[13px]">Or drag and drop a file</p>
                                <p className="mt-12 text-gray-400 text-sm">MP4</p>
                                <p className="mt-2 text-gray-400 text-[13px]">Up to 30 minutes</p>
                                <p className="mt-2 text-gray-400 text-[13px]">Less than 2 GB</p>
                                <label
                                    htmlFor="videoInput"
                                    className="px-2 py-1.5 mt-8 text-white text-[15px] w-[80%] bg-[#F02C56] rounded-sm cursor-pointer"
                                >
                                    Select file
                                </label>
                                <input
                                    type="file"
                                    id="videoInput"
                                    onChange={onVideoChange}
                                    hidden
                                    accept=".mp4,video/mp4"
                                />
                            </label>
                        :
                            <div
                                className="
                                    md:mx-0
                                    mx-auto
                                    mt-4
                                    md:mb-12
                                    mb-16
                                    flex
                                    items-center
                                    justify-center
                                    w-full
                                    max-w-[260px]
                                    h-[540px]
                                    p-3
                                    rounded-2xl
                                    cursor-pointer
                                    relative
                                "
                            >
                                {isUploading ? (
                                    <div className="absolute flex items-center justify-center z-20 bg-black h-full w-full rounded-[50px] bg-opacity-50">
                                        <div className="mx-auto flex items-center justify-center gap-1">
                                            <BiLoaderCircle className="animate-spin" color="#F12B56" size={30} />
                                            <div className="text-white font-bold">Uploading...</div>
                                        </div>
                                    </div>
                                ) : null}

                                <img
                                    className="absolute z-20 pointer-events-none"
                                    src="/images/mobile-case.png"
                                />
                                <img
                                    className="absolute right-4 bottom-6 z-20"
                                    width="90"
                                    src="/images/tiktok-logo-white.png"
                                />
                                <video
                                    autoPlay
                                    loop
                                    className="absolute rounded-3xl object-cover z-10 p-[13px] w-full h-full"
                                    src={videoDisplay}
                                />

                                <div className="absolute -bottom-12 flex items-center justify-between z-50 rounded-xl border w-full p-2 border-gray-300">
                                    <div className="flex items-center truncate">
                                        <AiOutlineCheckCircle size="16" className="min-w-[16px]"/>
                                        <p className="text-[11px] pl-1 truncate text-ellipsis">{videoFile?.name}</p>
                                    </div>
                                    <button onClick={() => clearVideo()} className="text-[11px] ml-2 font-semibold">
                                        Change
                                    </button>
                                </div>
                            </div>
                    ) : (
                        imageDisplays.length < 1 ?
                            <label
                                htmlFor="imageInput"
                                className="
                                    md:mx-0
                                    mx-auto
                                    mt-4
                                    mb-6
                                    flex
                                    flex-col
                                    items-center
                                    justify-center
                                    w-full
                                    max-w-[300px]
                                    h-[470px]
                                    text-center
                                    p-3
                                    border-2
                                    border-dashed
                                    border-gray-300
                                    rounded-lg
                                    hover:bg-gray-100
                                    cursor-pointer
                                "
                            >
                                <BiSolidCloudUpload size="40" color="#b3b3b1"/>
                                <p className="mt-4 text-[17px] dark:text-gray-400">Select images to upload</p>
                                <p className="mt-1.5 text-gray-500 text-[13px]">Choose 1 to 10 images</p>
                                <p className="mt-12 text-gray-400 text-sm">JPG, PNG, WEBP</p>
                                <p className="mt-2 text-gray-400 text-[13px]">Vertical or horizontal</p>
                                <p className="mt-2 text-gray-400 text-[13px]">Up to 5 seconds per image</p>
                                <label
                                    htmlFor="imageInput"
                                    className="px-2 py-1.5 mt-8 text-white text-[15px] w-[80%] bg-[#F02C56] rounded-sm cursor-pointer"
                                >
                                    Select images
                                </label>
                                <input
                                    type="file"
                                    id="imageInput"
                                    onChange={onImagesChange}
                                    hidden
                                    multiple
                                    accept="image/*"
                                />
                            </label>
                        :
                            <div
                                className="
                                    md:mx-0
                                    mx-auto
                                    mt-4
                                    md:mb-12
                                    mb-16
                                    flex
                                    items-center
                                    justify-center
                                    w-full
                                    max-w-[300px]
                                    h-[540px]
                                    p-3
                                    rounded-2xl
                                    cursor-pointer
                                    relative
                                "
                            >
                                {isUploading ? (
                                    <div className="absolute flex items-center justify-center z-30 bg-black h-full w-full rounded-[50px] bg-opacity-50">
                                        <div className="mx-auto flex items-center justify-center gap-1">
                                            <BiLoaderCircle className="animate-spin" color="#F12B56" size={30} />
                                            <div className="text-white font-bold">Uploading...</div>
                                        </div>
                                    </div>
                                ) : null}

                                <img
                                    className="absolute z-20 pointer-events-none"
                                    src="/images/mobile-case.png"
                                />
                                <ImageSlideshow
                                    imageUrls={imageDisplays}
                                    audioUrl={audioDisplay}
                                    className="absolute z-10 h-full w-full rounded-[34px] p-[13px]"
                                    imageClassName="rounded-[22px]"
                                    altPrefix="Upload preview image"
                                />

                                <div className="absolute -bottom-12 flex items-center justify-between z-50 rounded-xl border w-full p-2 border-gray-300">
                                    <div className="flex items-center truncate">
                                        <AiOutlineCheckCircle size="16" className="min-w-[16px]"/>
                                        <p className="text-[11px] pl-1 truncate text-ellipsis">
                                            {imageFiles.length} {imageFiles.length === 1 ? 'image' : 'images'} selected
                                        </p>
                                    </div>
                                    <button onClick={() => clearImages()} className="text-[11px] ml-2 font-semibold">
                                        Change
                                    </button>
                                </div>
                            </div>
                    )}


                    <div className="mt-4 mb-6 w-full">
                        <div className="flex bg-[#F8F8F8] py-4 px-6 dark:bg-dark">
                            <div>
                                <PiKnifeLight className="mr-4 dark:text-white" size="20"/>
                            </div>
                            <div>
                                <div className="text-semibold text-[15px] mb-1.5 dark:text-white">
                                    {uploadMode === 'video' ? 'Divide videos and edit' : 'Show mode preview'}
                                </div>
                                <div className="text-semibold text-[13px] text-gray-400">
                                    {uploadMode === 'video'
                                        ? 'You can quickly divide videos into multiple parts, remove redundant parts and turn landscape videos into portrait videos'
                                        : 'Images play as a clickable show, with vertical and horizontal photos fitted inside the viewer'}
                                </div>
                            </div>
                            <div className="flex justify-end max-w-[130px] w-full h-full text-center my-auto">
                                <button className="px-8 py-1.5 text-white text-[15px] bg-[#F02C56] rounded-sm">
                                    Edit
                                </button>
                            </div>
                        </div>

                        {uploadMode === 'images' ? (
                            <div className="mt-5">
                                <div className="mb-1 text-[15px] dark:text-white">Music</div>
                                {audioFile ? (
                                    <div className="flex items-center justify-between rounded-md border border-gray-200 p-2.5 dark:border-white/10">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <ImMusic className="min-w-[18px] text-[#F02C56]" size="18" />
                                            <span className="truncate text-[13px] dark:text-white">{audioFile.name}</span>
                                        </div>
                                        <button
                                            onClick={clearAudio}
                                            className="ml-2 text-[13px] font-semibold text-[#F02C56]"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : (
                                    <label
                                        htmlFor="audioInput"
                                        className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 p-2.5 text-[13px] text-gray-500 hover:bg-gray-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-dark"
                                    >
                                        <ImMusic size="18" />
                                        Add music (MP3, WAV, M4A...) — optional
                                    </label>
                                )}
                                <input
                                    type="file"
                                    id="audioInput"
                                    onChange={onAudioChange}
                                    hidden
                                    accept="audio/*,.mp3"
                                />
                            </div>
                        ) : null}

                        <div className="mt-5">
                            <div className="flex items-center justify-between">
                                <div className="mb-1 text-[15px] dark:text-white">Caption</div>
                                <div className="text-gray-400 text-[12px]">{caption.length}/150</div>
                            </div>
                            <input
                                maxLength={150}
                                type="text"
                                className="
                                    w-full
                                    border
                                    p-2.5
                                    rounded-md
                                    focus:outline-none
                                    dark:bg-dark
                                    dark:text-white
                                "
                                value={caption}
                                onChange={event => setCaption(event.target.value)}
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                disabled={isUploading}
                                onClick={() => discard()}
                                className="px-10 py-2.5 mt-8 border text-[16px] hover:bg-gray-100 dark:text-white dark:hover:text-black rounded-sm"
                            >
                                Discard
                            </button>
                            <button
                                disabled={isUploading}
                                onClick={() => createNewPost()}
                                className="px-10 py-2.5 mt-8 border text-[16px] text-white bg-[#F02C56] rounded-sm"
                            >
                                {isUploading ? <BiLoaderCircle className="animate-spin" color="#ffffff" size={25} /> : 'Post'}
                            </button>
                        </div>

                        {error ? (
                            <div className="text-red-600 mt-4">
                                {error.message}
                            </div>
                        ) : null}

                    </div>

                </div>
            </div>
        </UploadLayout>
    </>
  )
}

export default Upload
