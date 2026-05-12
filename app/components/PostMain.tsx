import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AiFillHeart } from 'react-icons/ai'
import { ImMusic } from 'react-icons/im'
import { useUser } from '../context/user'
import useCreateBucketUrl from '../hooks/useCreateBucketUrl'
import useCreateFollow from '../hooks/useCreateFollow'
import useDeleteFollow from '../hooks/useDeleteFollow'
import useIsFollowing from '../hooks/useIsFollowing'
import { PostMainCompTypes } from '../types'
import PostMainLikes from './PostMainLikes'

const followStateByPair = new Map<string, string | null>()

const PostMain = ({ post }: PostMainCompTypes) => {
  const { user } = useUser() || {};
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const postMainRef = useRef<HTMLDivElement>(null)
  
  // State to hold the follow document ID if following, or null if not.
  const [followId, setFollowId] = useState<string | null>(null)

  useEffect(() => {
    const checkFollow = async () => {
      if (!user?.id || !post.profile.user_id) {
        setFollowId(null)
        return
      }
      if (user.id === post.profile.user_id) {
        setFollowId(null)
        return
      }
      const followKey = `${user.id}:${post.profile.user_id}`
      const cachedFollowId = followStateByPair.get(followKey)

      if (cachedFollowId !== undefined) {
        setFollowId(cachedFollowId)
      }

      const id = await useIsFollowing(user.id, post.profile.user_id);
      followStateByPair.set(followKey, id)
      setFollowId(id);
    }
    checkFollow();
  }, [user?.id, post.profile.user_id]);

  const toggleFollow = useCallback(async () => {
    if (!user?.id) {
        // Redirect to login if not logged in? Or just return.
        // For now, let's just do nothing or maybe alert.
        console.log("Login to follow");
        return;
    }
    
    if (followId) {
        // Unfollow
        try {
            await useDeleteFollow(followId);
            followStateByPair.set(`${user.id}:${post.profile.user_id}`, null)
            setFollowId(null);
        } catch (error) {
            console.error(error);
        }
    } else {
        // Follow
        try {
            const id = await useCreateFollow(user.id, post.profile.user_id);
            followStateByPair.set(`${user.id}:${post.profile.user_id}`, id)
            setFollowId(id);
        } catch (error) {
            console.error(error);
        }
    }
  }, [user?.id, post.profile.user_id, followId]);

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
  }, [post.id]);

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
          <Link 
            href={`/profile/${post.profile.user_id}`}
            className="font-bold hover:underline cursor-pointer dark:text-white"
          >
            {post.profile.name}
          </Link>
          {user?.id !== post.profile.user_id && (
            <button
              onClick={toggleFollow}
              className={`flex items-center rounded-md py-1.5 px-8 mt-3 text-[15px] font-semibold ${
                followId
                  ? 'border border-gray-300 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 bg-white dark:bg-black'
                  : 'bg-rose-500 text-white hover:bg-rose-600'
              }`}
            >
              {followId ? 'Following' : 'Follow'}
            </button>
          )}
        </div>
        <p className="text-[15px] pb-0.5 break-words md:max-w-[400px] max-w-[300px] dark:text-white">
          {post.text}
        </p>
        <p className="text-[14px] text-gray-500 dark:text-gray-300 pb-0.5">
          #longbi #longkhongmap #longbabe
        </p>
        <p className="text-[14px] pb-0.5 flex items-center font-semibold dark:text-white">
          <ImMusic size="17" />
          <span className="px-1 text-[13px] truncate">original sound - {post.profile.name}</span>
          <AiFillHeart size="20" />
        </p>

        <div className="mt-2.5 flex flex-1">
          <div
            onClick={() => router.push(`/post/${post?.id}/${post?.profile?.user_id}`)}
            className="relative min-h-[525px] max-h-[625px] max-w-[295px] flex items-center bg-black rounded-xl cursor-pointer"
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
