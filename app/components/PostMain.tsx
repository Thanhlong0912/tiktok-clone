import React, { useEffect, useState } from 'react'
import { AiFillHeart } from "react-icons/ai"
import { ImMusic } from "react-icons/im"
import { PostMainCompTypes } from '../types'
import Link from 'next/link'
import PostMainLikes from './PostMainLikes'
import useCreateBucketUrl from '../hooks/useCreateBucketUrl'
import { useRouter } from 'next/navigation'

const PostMain = ({ post }: PostMainCompTypes) => {

    const router = useRouter()

    const [isFollow, setIsFollow] = useState(false);
    const handleClick = () => {
        setIsFollow(!isFollow);
    };

  useEffect(()=>{
    const video = document.getElementById(`video-${post?.id}`) as HTMLVideoElement
    const postMainElement = document.getElementById(`PostMain-${post.id}`);

    if (postMainElement) {
      let observer = new IntersectionObserver((entries) => {
          entries[0].isIntersecting ? video.play() : video.pause()
      }, { threshold: [0.6] });

      observer.observe(postMainElement);
    }
  }, [])

  return (
    <>
      <div id={`PostMain-${post.id}`} className="flex border-b py-6 px-4">
        <div className="cursor-pointer">
            <img className="rounded-full max-h-[60px]" width="60" src={useCreateBucketUrl(post?.profile?.image)} />
        </div>

        <div className="w-full px-2">
            <div className="flex items-center justify-between pb-0.5">
                <Link href={`/profile/${post.profile.user_id}`}>
                    <span className="font-bold hover:underline cursor-pointer dark:text-white">
                        {post.profile.name}
                    </span>
                </Link>
                <div onClick={handleClick}>
                    {isFollow ? (
                        <button
                        className="flex item-center rounded-md py-1.5 px-8 mt-3 text-[15px] text-white font-semibold bg-gray-400 dark:bg-gray-500"
                    >
                        Following
                    </button>
                    ) : (
                    <button className="flex item-center rounded-md py-1.5 px-8 mt-3 text-[15px] text-white font-semibold bg-rose-500">
                        Follow
                    </button>
                    )}
                </div>
            </div>
            <p className="text-[15px] pb-0.5 break-words md:max-w-[400px] max-w-[300px] dark:text-white">{post.text}</p>
            <p className="text-[14px] text-gray-500 dark:text-white pb-0.5">#longbi #longkhongmap #longbabe</p>
            <p className="text-[14px] pb-0.5 flex items-center font-semibold dark:text-white">
                <ImMusic size="17"/>
                <span className="px-1">original sound - LONGBI</span>
                <AiFillHeart size="20"/>
            </p>

            <div className="mt-2.5 flex">
                <div
                    onClick={() => router.push(`/post/${post?.id}/${post?.profile?.user_id}`)}
                    className="relative min-h-[480px] max-h-[580px] max-w-[260px] flex items-center bg-black rounded-xl cursor-pointer"
                >
                    <video
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
                    />
                </div>

                <PostMainLikes post={post} />
            </div>
        </div>
      </div>
    </>
  )
}

export default PostMain
