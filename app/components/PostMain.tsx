import React, { useEffect, useState, useRef, useCallback } from 'react'
import { AiFillHeart } from 'react-icons/ai'
import { ImMusic } from 'react-icons/im'
import { PostMainCompTypes } from '../types'
import Link from 'next/link'
import PostMainLikes from './PostMainLikes'
import useCreateBucketUrl from '../hooks/useCreateBucketUrl'
import { useRouter } from 'next/navigation'

const PostMain = ({ post }: PostMainCompTypes) => {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const postMainRef = useRef<HTMLDivElement>(null)
  const [isFollow, setIsFollow] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)

  const handleClick = useCallback(() => {
    setIsFollow(prev => !prev)
  }, [])

  // Toggle play/pause
  const togglePlayPause = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const video = videoRef.current
    if (video) {
      if (video.paused) {
        video.play().catch(console.error)
        setIsPlaying(true)
      } else {
        video.pause()
        setIsPlaying(false)
      }
    }
  }, [])

  // Toggle mute/unmute
  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const video = videoRef.current
    if (video) {
      video.muted = !video.muted
      setIsMuted(video.muted)
    }
  }, [])

  // Enhanced intersection observer for better video control
  useEffect(() => {
    const postMainElement = postMainRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setIsVisible(entry.isIntersecting)

        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          // Play video when post is well within viewport
          videoRef.current?.play().catch(console.error)
          setIsPlaying(true)
        } else {
          // Pause video when post is not in focus
          videoRef.current?.pause()
          setIsPlaying(false)
        }
      },
      {
        threshold: [0.1, 0.5, 0.9],
        rootMargin: '-10% 0px -10% 0px'
      }
    )

    if (postMainElement) {
      observer.observe(postMainElement)
    }

    return () => {
      if (postMainElement) {
        observer.unobserve(postMainElement)
      }
    }
  }, [post.id])

  // Handle video loading and auto-play
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleLoadedData = () => {
      if (isVisible) {
        video.play().catch(console.error)
        setIsPlaying(true)
      }
    }

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)

    video.addEventListener('loadeddata', handleLoadedData)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [isVisible])

  return (
    <div
      ref={postMainRef}
      className="flex border-b py-6 px-4 min-h-screen w-full"
    >
      <div className="cursor-pointer">
        <img
          className="rounded-full max-h-[60px]"
          width="60"
          src={useCreateBucketUrl(post?.profile?.image)}
          alt="Profile"
        />
      </div>

      <div className="w-full px-2">
        <div className="flex items-center justify-between pb-0.5">
          <Link href={`/profile/${post.profile.user_id}`}>
            <a className="font-bold hover:underline cursor-pointer dark:text-white">
              {post.profile.name}
            </a>
          </Link>
          <button
            onClick={handleClick}
            className={`flex items-center rounded-md py-1.5 px-8 mt-3 text-[15px] font-semibold transition-colors ${
              isFollow
                ? 'bg-gray-400 dark:bg-gray-500 text-white'
                : 'bg-rose-500 text-white hover:bg-rose-600'
            }`}
          >
            {isFollow ? 'Following' : 'Follow'}
          </button>
        </div>

        <p className="text-[15px] pb-0.5 break-words md:max-w-[400px] max-w-[300px] dark:text-white">
          {post.text}
        </p>

        <p className="text-[14px] text-gray-500 dark:text-white pb-0.5">
          #longbi #longkhongmap #longbabe
        </p>

        <p className="text-[14px] pb-0.5 flex items-center font-semibold dark:text-white">
          <ImMusic size="17" />
          <span className="px-1">original sound - LONGBI</span>
          <AiFillHeart size="20" />
        </p>

        <div className="mt-2.5 flex">
          <div
            onClick={() => router.push(`/post/${post?.id}/${post?.profile?.user_id}`)}
            className="relative min-h-[480px] max-h-[580px] max-w-[260px] flex items-center bg-black rounded-xl cursor-pointer"
          >
            <video
              ref={videoRef}
              id={`video-${post.id}`}
              loop
              muted={isMuted}
              playsInline
              className="rounded-xl object-cover mx-auto h-full"
              src={useCreateBucketUrl(post?.video_url)}
              preload="metadata"
            />
            <img
              className="absolute right-2 bottom-10"
              width="90"
              src="/images/tiktok-logo-white.png"
              alt="Logo"
            />

            {/* Video controls overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              <div className="flex gap-2">
                <button
                  onClick={togglePlayPause}
                  className="bg-black bg-opacity-50 text-white p-2 rounded-full"
                >
                  {isPlaying ? (
                    // Pause icon
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    // Play icon
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                {/* Mute/Unmute button */}
                <button
                  onClick={toggleMute}
                  className="bg-black bg-opacity-50 text-white p-2 rounded-full"
                >
                  {isMuted ? (
                    // Muted icon
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                    </svg>
                  ) : (
                    // Unmuted icon
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          <PostMainLikes post={post} />
        </div>
      </div>
    </div>
  )
}

export default PostMain;
