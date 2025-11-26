import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AiFillHeart } from 'react-icons/ai'
import { ImMusic } from 'react-icons/im'
import useCreateBucketUrl from '../hooks/useCreateBucketUrl'
import { PostMainCompTypes } from '../types'
import PostMainLikes from './PostMainLikes'

const PostMain = ({ post }: PostMainCompTypes) => {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const postMainRef = useRef<HTMLDivElement>(null)
  const [isFollow, setIsFollow] = useState(false)

  const handleClick = useCallback(() => {
    setIsFollow(prev => !prev)
  }, [])

  useEffect(() => {
    const postMainElement = postMainRef.current

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          videoRef.current?.play()
        } else {
          videoRef.current?.pause()
        }
      },
      { threshold: 0.6 }
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

  return (
    <div ref={postMainRef} className="flex border-b py-6 px-4 snap-start h-full">
      <div className="cursor-pointer">
        <img
          className="rounded-full max-h-[60px]"
          width="60"
          src={useCreateBucketUrl(post?.profile?.image)}
          alt="Profile"
        />
      </div>

      <div className="w-full px-2 flex flex-col h-full">
        <div className="flex items-center justify-between pb-0.5">
          <Link href={`/profile/${post.profile.user_id}`}>
            <a className="font-bold hover:underline cursor-pointer dark:text-white">
              {post.profile.name}
            </a>
          </Link>
          <button
            onClick={handleClick}
            className={`flex items-center rounded-md py-1.5 px-8 mt-3 text-[15px] font-semibold ${
              isFollow
                ? 'bg-gray-400 dark:bg-gray-500 text-white'
                : 'bg-rose-500 text-white'
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
            className="relative min-h-[500px] max-h-[600px] max-w-[260px] flex items-center bg-black rounded-xl cursor-pointer"
          >
            <video
              ref={videoRef}
              id={`video-${post.id}`}
              loop
              controls
              className="rounded-xl object-cover mx-auto h-full"
              src={useCreateBucketUrl(post?.video_url)}
            />
            <img
              className="absolute right-2 bottom-10"
              width="90"
              src="/images/tiktok-logo-white.png"
              alt="Logo"
            />
          </div>

          <PostMainLikes post={post} />
        </div>
      </div>
    </div>
  )
}

export default PostMain;
