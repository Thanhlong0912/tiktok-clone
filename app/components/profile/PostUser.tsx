import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl'
import { PostUserCompTypes } from "@/app/types"
import { getImagePostAudioId, getImagePostIds, isImagePost } from '@/app/utils/postMedia'
import { pauseOtherVideos, pauseVideosDuringNavigation, rememberVideoPlayback } from '@/app/utils/videoPlayback'
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { AiFillHeart, AiOutlineLoading3Quarters } from "react-icons/ai"
import CaptionText from '../CaptionText'
import ImageSlideshow from '../ImageSlideshow'
import { formatCount } from '@/app/utils/formatNumber'
import { getPostLikeCount } from '@/app/utils/postLikeCounts'

const PostUser = ({ post }: PostUserCompTypes) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [likeCount, setLikeCount] = useState<number | null>(null)
  const [isHovering, setIsHovering] = useState<boolean>(false)

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
    return () => {
      videoRef.current?.pause()
    }
  }, [post?.id])

  // Hover previews play with music; if the browser blocks unmuted autoplay we
  // retry muted so the preview still runs.
  const handleHoverStart = () => {
    setIsHovering(true)

    const video = videoRef.current
    if (!video) return

    pauseOtherVideos(video)
    video.muted = false
    video.play().catch(() => {
      video.muted = true
      video.play().catch(() => null)
    })
  }

  const handleHoverEnd = () => {
    setIsHovering(false)

    const video = videoRef.current
    if (!video) return

    video.pause()
    video.muted = true
  }

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
  const postAudioId = getImagePostAudioId(post.video_url)

  return (
    <>
      <div
        className="relative brightness-90 hover:brightness-[1.1] cursor-pointer"
        onMouseEnter={handleHoverStart}
        onMouseLeave={handleHoverEnd}
      >
          {!post.video_url ? (
              <div className="absolute flex items-center justify-center top-0 left-0 aspect-[3/4] w-full object-cover rounded-md bg-surface-subtle">
                  <AiOutlineLoading3Quarters className="animate-spin ml-1" size="80" color="#FFFFFF" />
              </div>
          ) : postIsImage ? (
              <Link href={`/post/${post.id}/${post.user_id}`} onClick={openPostDetail}>
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-black">
                      <ImageSlideshow
                          imageIds={postImageIds}
                          audioId={postAudioId}
                          muted={false}
                          autoPlay={isHovering}
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
                      playsInline
                      className="aspect-[3/4] object-cover rounded-md"
                      src={useCreateBucketUrl(post.video_url)}
                  />
              </Link>
          )}
          <div className="px-1">
              <p className="text-ink text-[15px] pt-1 break-words">
                  <CaptionText text={post.text} />
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
