"use client"

import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { AiOutlineCheckCircle } from "react-icons/ai"
import { BiImageAdd, BiLoaderCircle, BiSolidCloudUpload, BiVideoPlus } from "react-icons/bi"
import { ImMusic } from "react-icons/im"
import { MdOutlineClosedCaption } from "react-icons/md"
import { PiKnifeLight } from 'react-icons/pi'
import ImageSlideshow from '../components/ImageSlideshow'
import CaptionComposer from '../components/upload/CaptionComposer'
import { useUser } from '../context/user'
import useCreatePost from '../hooks/useCreatePost'
import UploadLayout from '../layouts/UploadLayout'
import { UploadError } from '../types'
import { MAX_IMAGE_UPLOAD_COUNT, UploadPostMedia } from '../utils/postMedia'
import {
    hasVttExtension,
    isWebVtt,
    MAX_CAPTION_FILE_BYTES,
    MAX_CAPTION_FILE_LABEL,
} from '../utils/captionFile'
import { showToast } from '../utils/toast'
import { captureVideoFrame, readVideoMetadata, type VideoMetadata } from '../utils/posterFrame'

type UploadMode = 'video' | 'images'

const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024
const MAX_VIDEO_SIZE_LABEL = '200 MB'
const MAX_VIDEO_DURATION_MS = 10 * 60 * 1000
const MAX_VIDEO_DURATION_LABEL = '10 minutes'

// Frames offered as cover options, as a fraction of the clip.
const COVER_FRACTIONS = [0.05, 0.25, 0.5, 0.75, 0.95]

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
    const [captionsFile, setCaptionsFile] = useState<File | null>(null);
    let [error, setError] = useState<UploadError | null>(null);
    let [isUploading, setIsUploading] = useState<boolean>(false);
    let [uploadProgress, setUploadProgress] = useState<number>(0);
    let [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
    const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
    const [coverOptions, setCoverOptions] = useState<Array<{ file: File; url: string }>>([]);
    const [coverIndex, setCoverIndex] = useState<number>(0);
    const [isPreparingCover, setIsPreparingCover] = useState<boolean>(false);

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

    const applyVideoFile = async (file: File) => {
        if (!file.type.startsWith('video/')) {
            setError({ type: 'File', message: 'Only video files are supported' })
            return
        }

        // The limit and the message used to disagree: this rejected anything
        // over 50 MB while telling the user the cap was 2 GB.
        if (file.size > MAX_VIDEO_SIZE_BYTES) {
            setError({ type: 'File', message: `Videos must be smaller than ${MAX_VIDEO_SIZE_LABEL}` })
            return
        }

        setVideoDisplay(URL.createObjectURL(file))
        setVideoFile(file)
        setError(null)

        // Duration was never checked, despite the drop zone promising a limit.
        const meta = await readVideoMetadata(file)
        if (meta && meta.durationMs > MAX_VIDEO_DURATION_MS) {
            setError({ type: 'File', message: `Videos must be shorter than ${MAX_VIDEO_DURATION_LABEL}` })
            return
        }
        setVideoMeta(meta)

        await buildCoverOptions(file, meta)
    }

    /**
     * Pre-renders a few candidate cover frames so the creator can pick one.
     * Without a cover, every grid tile has to download video bytes to paint
     * its first frame.
     */
    const buildCoverOptions = async (file: File, meta: VideoMetadata | null) => {
        setIsPreparingCover(true)
        coverOptions.forEach((option) => URL.revokeObjectURL(option.url))
        setCoverOptions([])
        setCoverIndex(0)

        try {
            const durationSeconds = (meta?.durationMs ?? 0) / 1000
            const times = durationSeconds > 0
                ? COVER_FRACTIONS.map((fraction) => durationSeconds * fraction)
                : [0]

            const frames: Array<{ file: File; url: string }> = []
            for (const time of times) {
                const capture = await captureVideoFrame(file, time)
                if (capture) {
                    frames.push({ file: capture.file, url: URL.createObjectURL(capture.file) })
                }
            }

            setCoverOptions(frames)
        } catch (error) {
            // A missing cover degrades the thumbnail; it must not block posting.
            console.error(error)
        } finally {
            setIsPreparingCover(false)
        }
    }

    const applyImageFiles = (selectedFiles: File[]) => {
        if (selectedFiles.length > MAX_IMAGE_UPLOAD_COUNT) {
            setError({ type: 'File', message: `You can upload up to ${MAX_IMAGE_UPLOAD_COUNT} images` })
            return
        }

        const validImages = selectedFiles.filter((file) => file.type.startsWith('image/'))
        if (validImages.length !== selectedFiles.length) {
            setError({ type: 'File', message: 'Only image files are supported' })
            return
        }

        setImageDisplays(validImages.map((file) => URL.createObjectURL(file)))
        setImageFiles(validImages)
        setError(null)
    }

    const onDropZoneDragOver = (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        setIsDraggingOver(true)
    }

    const onDropZoneDragLeave = () => setIsDraggingOver(false)

    const onDropZoneDrop = (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        setIsDraggingOver(false)

        const droppedFiles = Array.from(event.dataTransfer.files || [])
        if (droppedFiles.length < 1) return

        if (uploadMode === 'video') {
            applyVideoFile(droppedFiles[0])
        } else {
            applyImageFiles(droppedFiles)
        }
    }

    const onVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;

        if (files && files.length > 0) {
            applyVideoFile(files[0])
        }

        event.target.value = ''
    }

    const onImagesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(event.target.files || [])

        if (selectedFiles.length < 1) {
            event.target.value = ''
            return
        }

        applyImageFiles(selectedFiles)
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

    /**
     * Subtitles are checked by content, not just by name: an .srt renamed to
     * .vtt uploads fine and then renders zero cues, which is impossible for the
     * creator to diagnose after the fact.
     */
    const onCaptionsChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files

        if (!files || files.length < 1) {
            event.target.value = ''
            return
        }

        const file = files[0]
        event.target.value = ''

        if (!hasVttExtension(file.name)) {
            setError({ type: 'File', message: 'Subtitles must be a WebVTT (.vtt) file' })
            return
        }

        if (file.size > MAX_CAPTION_FILE_BYTES) {
            setError({ type: 'File', message: `Subtitles must be smaller than ${MAX_CAPTION_FILE_LABEL}` })
            return
        }

        if (!isWebVtt(await file.text())) {
            setError({ type: 'File', message: 'That file does not start with WEBVTT. Convert it to WebVTT first.' })
            return
        }

        setCaptionsFile(file)
        setError(null)
    }

    const discard = () => {
        setVideoDisplay('')
        setVideoFile(null)
        setImageDisplays([])
        setImageFiles([])
        setAudioFile(null)
        setAudioDisplay('')
        setCaptionsFile(null)
        setCaption('')
        setError(null)
    }

    const clearVideo = () => {
        setVideoDisplay('')
        setVideoFile(null)
        setVideoMeta(null)
        // Object URLs for the cover thumbnails leak until revoked.
        coverOptions.forEach((option) => URL.revokeObjectURL(option.url))
        setCoverOptions([])
        setCoverIndex(0)
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
        setUploadProgress(0)

        try {
            const { captionsAttached } = await useCreatePost(
                media,
                contextUser?.user?.id,
                caption.trim(),
                setUploadProgress,
                {
                    poster: uploadMode === 'video' ? coverOptions[coverIndex]?.file ?? null : null,
                    metadata: uploadMode === 'video' ? videoMeta : null,
                    captions: uploadMode === 'video' ? captionsFile : null,
                }
            )
            // The post is live either way -- only the subtitle attach can fail
            // on its own, and that must not read as a failed upload.
            showToast(
                captionsAttached
                    ? 'Your post is live!'
                    : 'Your post is live, but the subtitles could not be attached.',
                captionsAttached ? 'success' : 'error'
            )
            router.push(`/profile/${contextUser?.user?.id}`)
        } catch (error) {
            console.error(error)
            showToast('Upload failed. Please try again.', 'error')
        } finally {
            // Was set false only on the happy path AFTER router.push, so a
            // throw from the navigation left the button spinning forever.
            setIsUploading(false)
        }
    }

    const modeTitle = uploadMode === 'video' ? 'Upload video' : 'Upload images'
    const modeSubtitle = uploadMode === 'video'
        ? 'Post a video to your account'
        : 'Post 1 to 10 images in show mode'

  return (
    <>
      <UploadLayout>
            <div className="w-full mt-[80px] mb-[40px] bg-surface-elevated shadow-lg rounded-md py-6 md:px-10 px-4">
                <div>
                    <h1 className="text-[23px] font-semibold text-ink">{modeTitle}</h1>
                    <h2 className="text-ink-soft mt-1">{modeSubtitle}</h2>
                </div>

                <div className="mt-6 inline-flex rounded-md border border-line bg-surface-subtle p-1">
                    <button
                        type="button"
                        onClick={() => {
                            setUploadMode('video')
                            setError(null)
                        }}
                        className={`flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold ${
                            uploadMode === 'video'
                                ? 'bg-surface-elevated text-tiktok shadow-sm'
                                : 'text-ink-soft hover:text-ink'
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
                                ? 'bg-surface-elevated text-tiktok shadow-sm'
                                : 'text-ink-soft hover:text-ink'
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
                                onDragOver={onDropZoneDragOver}
                                onDragLeave={onDropZoneDragLeave}
                                onDrop={onDropZoneDrop}
                                className={`
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
                                    rounded-lg
                                    hover:bg-surface-subtle
                                    cursor-pointer
                                    ${isDraggingOver ? 'border-tiktok bg-surface-subtle' : 'border-line'}
                                `}
                            >
                                <BiSolidCloudUpload size="40" color="#b3b3b1"/>
                                <p className="mt-4 text-[17px] text-ink-soft">Select video to upload</p>
                                <p className="mt-1.5 text-ink-soft text-[13px]">Or drag and drop a file</p>
                                <p className="mt-12 text-ink-soft text-sm">MP4</p>
                                <p className="mt-2 text-ink-soft text-[13px]">Up to 10 minutes</p>
                                <p className="mt-2 text-ink-soft text-[13px]">Less than 200 MB</p>
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
                                    accept="video/*"
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
                                    <div className="absolute flex flex-col items-center justify-center z-20 bg-black h-full w-full rounded-[50px] bg-opacity-50 px-8">
                                        <div className="mx-auto flex items-center justify-center gap-1">
                                            <BiLoaderCircle className="animate-spin" color="#F12B56" size={30} />
                                            <div className="text-white font-bold">Uploading {uploadProgress}%</div>
                                        </div>
                                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                                            <div className="h-full bg-tiktok transition-[width]" style={{ width: `${uploadProgress}%` }} />
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

                                <div className="absolute -bottom-12 flex items-center justify-between z-50 rounded-xl border w-full p-2 border-line">
                                    <div className="flex items-center truncate text-ink">
                                        <AiOutlineCheckCircle size="16" className="min-w-[16px]"/>
                                        <p className="text-[11px] pl-1 truncate text-ellipsis">{videoFile?.name}</p>
                                    </div>
                                    <button onClick={() => clearVideo()} className="text-[11px] ml-2 font-semibold text-ink">
                                        Change
                                    </button>
                                </div>

                                {/* Cover picker. The captured frame is stored as
                                    posts.poster_key so grids and the feed paint
                                    without downloading video bytes. */}
                                <div className="absolute -bottom-[132px] left-0 w-full">
                                    <p className="text-[13px] font-semibold text-ink">Cover</p>
                                    {isPreparingCover ? (
                                        <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-soft">
                                            <BiLoaderCircle className="animate-spin" size={14} />
                                            Generating covers...
                                        </div>
                                    ) : coverOptions.length > 0 ? (
                                        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
                                            {coverOptions.map((option, index) => (
                                                <button
                                                    key={option.url}
                                                    onClick={() => setCoverIndex(index)}
                                                    aria-label={`Use cover ${index + 1}`}
                                                    aria-pressed={coverIndex === index}
                                                    className={`h-16 w-11 shrink-0 overflow-hidden rounded border-2 transition-colors ${
                                                        coverIndex === index ? 'border-tiktok' : 'border-transparent'
                                                    }`}
                                                >
                                                    <img src={option.url} alt="" className="h-full w-full object-cover" />
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="mt-2 text-[12px] text-ink-soft">
                                            Couldn&apos;t generate a cover for this file. Your post will still upload.
                                        </p>
                                    )}
                                </div>
                            </div>
                    ) : (
                        imageDisplays.length < 1 ?
                            <label
                                htmlFor="imageInput"
                                onDragOver={onDropZoneDragOver}
                                onDragLeave={onDropZoneDragLeave}
                                onDrop={onDropZoneDrop}
                                className={`
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
                                    rounded-lg
                                    hover:bg-surface-subtle
                                    cursor-pointer
                                    ${isDraggingOver ? 'border-tiktok bg-surface-subtle' : 'border-line'}
                                `}
                            >
                                <BiSolidCloudUpload size="40" color="#b3b3b1"/>
                                <p className="mt-4 text-[17px] text-ink-soft">Select images to upload</p>
                                <p className="mt-1.5 text-ink-soft text-[13px]">Choose 1 to 10 images</p>
                                <p className="mt-12 text-ink-soft text-sm">JPG, PNG, WEBP</p>
                                <p className="mt-2 text-ink-soft text-[13px]">Vertical or horizontal</p>
                                <p className="mt-2 text-ink-soft text-[13px]">Up to 5 seconds per image</p>
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
                                    <div className="absolute flex flex-col items-center justify-center z-30 bg-black h-full w-full rounded-[50px] bg-opacity-50 px-8">
                                        <div className="mx-auto flex items-center justify-center gap-1">
                                            <BiLoaderCircle className="animate-spin" color="#F12B56" size={30} />
                                            <div className="text-white font-bold">Uploading {uploadProgress}%</div>
                                        </div>
                                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                                            <div className="h-full bg-tiktok transition-[width]" style={{ width: `${uploadProgress}%` }} />
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

                                <div className="absolute -bottom-12 flex items-center justify-between z-50 rounded-xl border w-full p-2 border-line">
                                    <div className="flex items-center truncate text-ink">
                                        <AiOutlineCheckCircle size="16" className="min-w-[16px]"/>
                                        <p className="text-[11px] pl-1 truncate text-ellipsis">
                                            {imageFiles.length} {imageFiles.length === 1 ? 'image' : 'images'} selected
                                        </p>
                                    </div>
                                    <button onClick={() => clearImages()} className="text-[11px] ml-2 font-semibold text-ink">
                                        Change
                                    </button>
                                </div>
                            </div>
                    )}


                    <div className="mt-4 mb-6 w-full">
                        <div className="flex bg-surface-subtle py-4 px-6">
                            <div>
                                <PiKnifeLight className="mr-4 text-ink" size="20"/>
                            </div>
                            <div>
                                <div className="text-semibold text-[15px] mb-1.5 text-ink">
                                    {uploadMode === 'video' ? 'Divide videos and edit' : 'Show mode preview'}
                                </div>
                                <div className="text-semibold text-[13px] text-ink-soft">
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
                                <div className="mb-1 text-[15px] text-ink">Music</div>
                                {audioFile ? (
                                    <div className="flex items-center justify-between rounded-md border border-line p-2.5">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <ImMusic className="min-w-[18px] text-tiktok" size="18" />
                                            <span className="truncate text-[13px] text-ink">{audioFile.name}</span>
                                        </div>
                                        <button
                                            onClick={clearAudio}
                                            className="ml-2 text-[13px] font-semibold text-tiktok"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : (
                                    <label
                                        htmlFor="audioInput"
                                        className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line p-2.5 text-[13px] text-ink-soft hover:bg-surface-subtle"
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

                        {uploadMode === 'video' ? (
                            <div className="mt-5">
                                <div className="mb-1 text-[15px] text-ink">Subtitles</div>
                                {captionsFile ? (
                                    <div className="flex items-center justify-between rounded-md border border-line p-2.5">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <MdOutlineClosedCaption className="min-w-[18px] text-tiktok" size="18" />
                                            <span className="truncate text-[13px] text-ink">{captionsFile.name}</span>
                                        </div>
                                        <button
                                            onClick={() => setCaptionsFile(null)}
                                            className="ml-2 text-[13px] font-semibold text-tiktok"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : (
                                    <label
                                        htmlFor="captionsInput"
                                        className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line p-2.5 text-[13px] text-ink-soft hover:bg-surface-subtle"
                                    >
                                        <MdOutlineClosedCaption size="18" />
                                        Add subtitles (WebVTT .vtt) — optional
                                    </label>
                                )}
                                <p className="mt-1 text-[12px] text-ink-soft">
                                    Viewers can switch these on from the video options menu.
                                </p>
                                <input
                                    type="file"
                                    id="captionsInput"
                                    onChange={onCaptionsChange}
                                    hidden
                                    accept=".vtt,text/vtt"
                                />
                            </div>
                        ) : null}

                        <div className="mt-5">
                            <div className="mb-1 text-[15px] text-ink">Caption</div>
                            <CaptionComposer value={caption} onChange={setCaption} maxLength={150} />
                            <p className="mt-1 text-[12px] text-ink-soft">
                                Use # to add hashtags people can filter in Explore, and @ to mention creators.
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                disabled={isUploading}
                                onClick={() => discard()}
                                className="px-10 py-2.5 mt-8 border border-line text-[16px] text-ink hover:bg-surface-subtle rounded-sm"
                            >
                                Discard
                            </button>
                            <button
                                disabled={isUploading}
                                onClick={() => createNewPost()}
                                className="px-10 py-2.5 mt-8 border text-[16px] text-white bg-[#F02C56] rounded-sm"
                            >
                                {isUploading ? (
                                    <span className="flex items-center gap-2">
                                        <BiLoaderCircle className="animate-spin" color="#ffffff" size={22} />
                                        {uploadProgress}%
                                    </span>
                                ) : 'Post'}
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
