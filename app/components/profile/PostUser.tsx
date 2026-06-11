import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'
import { PostUserCompTypes } from "@/app/types"
import { pauseOtherVideos, pauseVideosDuringNavigation, rememberVideoPlayback } from '@/app/utils/videoPlayback'
import Link from "next/link"
import { useEffect, useRef } from "react"
import { AiOutlineLoading3Quarters } from "react-icons/ai"
import { BiErrorCircle } from "react-icons/bi"
import { SiSoundcharts } from "react-icons/si"

const PostUser = ({ post }: PostUserCompTypes) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    const handleMouseEnter = () => {
      pauseOtherVideos(video)
      video.play().catch(() => null)
    }

    const handleMouseLeave = () => {
      video.pause()
    }

    const timer = setTimeout(() => {
      video.addEventListener('mouseenter', handleMouseEnter)
      video.addEventListener('mouseleave', handleMouseLeave)
    }, 50)

    return () => {
      clearTimeout(timer)
      video.removeEventListener('mouseenter', handleMouseEnter)
      video.removeEventListener('mouseleave', handleMouseLeave)
      video.pause()
    }

  }, [post?.id])

  const openPostDetail = () => {
    rememberVideoPlayback({
      postId: post.id,
      userId: post.user_id,
      video: videoRef.current,
      source: 'profile',
    })
    pauseVideosDuringNavigation()
  }

  return (
    <>
      <div className="relative brightness-90 hover:brightness-[1.1] cursor-pointer">
          {!post.video_url ? (
              <div className="absolute flex items-center justify-center top-0 left-0 aspect-[3/4] w-full object-cover rounded-md bg-black dark:bg-white">
                  <AiOutlineLoading3Quarters className="animate-spin ml-1" size="80" color="#FFFFFF" />
              </div>
          ) : (
              <Link href={`/post/${post.id}/${post.user_id}`} onClick={openPostDetail}>
                  <video
                      ref={videoRef}
                      id={`video${post.id}`}
                      loop
                      muted
                      className="aspect-[3/4] object-cover rounded-md"
                      src={useCreateBucketUrl(post.video_url)}
                  />
              </Link>
          )}
          <div className="px-1">
              <p className="text-gray-700 dark:text-white text-[15px] pt-1 break-words">
                  {post.text}
              </p>
              <div className="flex items-center gap-1 -ml-1 text-gray-600 dark:text-white font-bold text-xs">
                  <SiSoundcharts size="15"/>
                  100%
                  <BiErrorCircle  size="16"/>
              </div>
          </div>
      </div>
    </>
  )
}

export default PostUser
