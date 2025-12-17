"use client"

import ClientOnly from "@/app/components/ClientOnly"
import PostUser from "@/app/components/profile/PostUser"
import { useUser } from "@/app/context/user"
import useCreateBucketUrl from "@/app/hooks/useCreateBucketUrl"
import useCreateFollow from "@/app/hooks/useCreateFollow"
import useDeleteFollow from "@/app/hooks/useDeleteFollow"
import useGetFollowers from "@/app/hooks/useGetFollowers"
import useGetFollowing from "@/app/hooks/useGetFollowing"
import useGetLikesByPostId from "@/app/hooks/useGetLikesByPostId"
import useIsFollowing from "@/app/hooks/useIsFollowing"
import MainLayout from "@/app/layouts/MainLayout"
import { useGeneralStore } from "@/app/stores/general"
import { usePostStore } from "@/app/stores/post"
import { useProfileStore } from "@/app/stores/profile"
import { ProfilePageTypes, User } from "@/app/types"
import { useCallback, useEffect, useState } from "react"
import { BsPencil } from "react-icons/bs"


const Profile = ({ params }: ProfilePageTypes) => {
    const contextUser = useUser()
    let { postsByUser, setPostsByUser } = usePostStore()
    let { setCurrentProfile, currentProfile } = useProfileStore()
    let { isEditProfileOpen, setIsEditProfileOpen } = useGeneralStore()
    const [followId, setFollowId] = useState<string | null>(null)
    const [followersCount, setFollowersCount] = useState<number>(0)
    const [followingCount, setFollowingCount] = useState<number>(0)
    const [likesCount, setLikesCount] = useState<number>(0)

    useEffect(() => {
        const getStats = async () => {
            if (!params?.id) return;
            const followers = await useGetFollowers(params.id);
            setFollowersCount(followers.length);
            
            const following = await useGetFollowing(params.id);
            setFollowingCount(following.length);
        }
        getStats();
    }, [params?.id, followId]) // Update stats when follow status changes (e.g. self follow/unfollow)

    useEffect(() => {
        const getLikes = async () => {
             if (!postsByUser || postsByUser.length < 1) {
                 setLikesCount(0);
                 return;
             }
             let totalLikes = 0;
             // We can run these in parallel
             const promises = postsByUser.map(async (post) => {
                 const likes = await useGetLikesByPostId(post.id);
                 return likes.length;
             });
             const results = await Promise.all(promises);
             totalLikes = results.reduce((acc, curr) => acc + curr, 0);
             setLikesCount(totalLikes);
        }
        getLikes();
    }, [postsByUser])

    useEffect(() => {
        const checkFollow = async () => {
            if (!contextUser?.user?.id || !params?.id || contextUser.user.id === params?.id) return;
            const id = await useIsFollowing(contextUser.user.id, params.id);
            setFollowId(id);
        }
        checkFollow();
        setCurrentProfile(params?.id)
        setPostsByUser(params?.id)
    }, [contextUser?.user?.id, params?.id])

    const toggleFollow = useCallback(async () => {
        if (!contextUser?.user?.id || !params?.id) return;
        
        if (followId) {
            try {
                await useDeleteFollow(followId);
                setFollowId(null);
            } catch (error) {
                console.error(error);
            }
        } else {
            try {
                await useCreateFollow(contextUser.user.id, params.id);
                 const id = await useIsFollowing(contextUser.user.id, params.id);
                 setFollowId(id);
            } catch (error) {
                console.error(error);
            }
        }
    }, [contextUser?.user?.id, params?.id, followId]);

  return (
    <>
      <MainLayout>
        <div className="pt-[90px] ml-[90px] 2xl:pl-[185px] lg:pl-[160px] lg:pr-0 w-[calc(100%-90px)] pr-3 max-w-[1800px] 2xl:mx-auto">

            <div className="flex w-[calc(100vw-230px)]">

                <ClientOnly>
                    {currentProfile ? (
                        <img className="w-[120px] min-w-[120px] rounded-full" src={useCreateBucketUrl(currentProfile?.image)} />
                    ) : (
                        <div className="min-w-[150px] h-[120px] bg-gray-200 rounded-full" />
                    )}
                </ClientOnly>

                <div className="ml-5 w-full">
                    <ClientOnly>
                        {(currentProfile as User)?.name ? (
                            <div>
                                <p className="text-[30px] dark:text-white font-bold truncate">{currentProfile?.name}</p>
                                <p className="text-[18px] dark:text-white truncate">{currentProfile?.name}</p>
                            </div>
                        ) : (
                            <div className="h-[60px]" />
                        )}
                    </ClientOnly>


                    {contextUser?.user?.id == params?.id ? (
                        <button
                            onClick={() => setIsEditProfileOpen(isEditProfileOpen = !isEditProfileOpen)}
                            className="flex item-center rounded-md py-1.5 px-3.5 mt-3 text-[15px] font-semibold border hover:bg-gray-100 dark:hover:bg-medium dark:text-white"
                        >
                            <BsPencil className="mt-0.5 mr-1" size="18"/>
                            <span>Edit profile</span>
                        </button>
                    ) : (
                        <button 
                            onClick={toggleFollow}
                            className={`flex item-center rounded-md py-1.5 px-8 mt-3 text-[15px] text-white font-semibold ${
                                followId ? 'bg-gray-400' : 'bg-[#F02C56]'
                            }`}
                        >
                            {followId ? 'Following' : 'Follow'}
                        </button>
                    )}
                </div>

            </div>

            <div className="flex items-center pt-4">
                <div className="mr-4">
                    <span className="font-bold dark:text-white">{followingCount}</span>
                    <span className="text-gray-500 dark:text-white font-light text-[15px] pl-1.5">Following</span>
                </div>
                <div className="mr-4">
                    <span className="font-bold dark:text-white">{followersCount}</span>
                    <span className="text-gray-500 dark:text-white font-light text-[15px] pl-1.5">Followers</span>
                </div>
                <div className="mr-4">
                    <span className="font-bold dark:text-white">{likesCount}</span>
                    <span className="text-gray-500 dark:text-white font-light text-[15px] pl-1.5">Likes</span>
                </div>
            </div>

            <ClientOnly>
                <p className="pt-4 mr-4 text-gray-500 dark:text-white font-light text-[15px] pl-1.5 max-w-[500px]">
                    {currentProfile?.bio}
                </p>
            </ClientOnly>

            <ul className="w-full flex items-center pt-4 border-b">
                <li className="w-60 text-center py-2 text-[17px] font-semibold border-b-2 border-b-black dark:text-white dark:border-b-white">Videos</li>
                <li className="w-60 text-gray-500 dark:text-white text-center py-2 text-[17px] font-semibold">Liked</li>
            </ul>

            <ClientOnly>
                <div className="mt-4 grid 2xl:grid-cols-6 xl:grid-cols-5 lg:grid-cols-4 md:grid-cols-3 grid-cols-2 gap-3">
                    {postsByUser?.map((post, index) => (
                        <PostUser key={index} post={post} />
                    ))}
                </div>
            </ClientOnly>

            <div className="pb-20" />
        </div>
    </MainLayout>
    </>
  )
}

export default Profile
