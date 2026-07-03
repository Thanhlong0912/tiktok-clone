import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'
import { PostUserCompTypes } from "@/app/types"
import { getImagePostIds, isImagePost } from '@/app/utils/postMedia'
import { pauseOtherVideos, pauseVideosDuringNavigation, rememberVideoPlayback } from '@/app/utils/videoPlayback'
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { AiFillHeart, AiOutlineLoading3Quarters } from "react-icons/ai"
import ImageSlideshow from '../ImageSlideshow'
import { formatCount } from '@/app/utils/formatNumber'
import { getPostLikeCount } from '@/app/utils/postLikeCounts'

const PostUser = ({ post }: PostUserCompTypes) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [likeCount, setLikeCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    getPostLikeCount(post.id)
      .then((count) => {
        if (!cancelled) setLikeCount(count)
      })
      .catch(() => null)

    return () => {
      cancelled = true
    }
  }, [post.id])

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

  const postIsImage = isImagePost(post.video_url)
  const postImageIds = getImagePostIds(post.video_url)

  return (
    <>
      <div className="relative brightness-90 hover:brightness-[1.1] cursor-pointer">
          {!post.video_url ? (
              <div className="absolute flex items-center justify-center top-0 left-0 aspect-[3/4] w-full object-cover rounded-md bg-surface-subtle">
                  <AiOutlineLoading3Quarters className="animate-spin ml-1" size="80" color="#FFFFFF" />
              </div>
          ) : postIsImage ? (
              <Link href={`/post/${post.id}/${post.user_id}`} onClick={openPostDetail}>
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-black">
                      <ImageSlideshow
                          imageIds={postImageIds}
                          autoPlay={false}
                          showControls={false}
                          showDots={false}
                          className="h-full w-full rounded-md"
                          imageClassName="rounded-md"
                          altPrefix="Profile post image"
                      />
                      {postImageIds.length > 1 ? (
                          <div className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[11px] font-semibold text-white">
                              {postImageIds.length}
                          </div>
                      ) : null}
                  </div>
              </Link>
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
              <p className="text-ink text-[15px] pt-1 break-words">
                  {post.text}
              </p>
              {likeCount !== null ? (
                  <div className="flex items-center gap-1 text-ink-soft font-semibold text-xs">
                      <AiFillHeart size="14"/>
                      {formatCount(likeCount)}
                  </div>
              ) : null}
          </div>
      </div>
    </>
  )
}

export default PostUser
