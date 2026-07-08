"use client"

import ClientOnly from "@/app/components/ClientOnly"
import PostUser from "@/app/components/profile/PostUser"
import { useUser } from "@/app/context/user"
import useCreateBucketUrl from "@/app/hooks/useCreateBucketUrl"
import useCreateFollow from "@/app/hooks/useCreateFollow"
import useDeleteFollow from "@/app/hooks/useDeleteFollow"
import useGetFollowers from "@/app/hooks/useGetFollowers"
import useGetFollowing from "@/app/hooks/useGetFollowing"
import useGetLikedPosts from "@/app/hooks/useGetLikedPosts"
import useGetLikesByPostId from "@/app/hooks/useGetLikesByPostId"
import useGetRepostedPosts from "@/app/hooks/useGetRepostedPosts"
import useGetSavedPosts from "@/app/hooks/useGetSavedPosts"
import useIsFollowing from "@/app/hooks/useIsFollowing"
import MainLayout from "@/app/layouts/MainLayout"
import MobileBottomNav from "@/app/components/MobileBottomNav"
import { useGeneralStore } from "@/app/stores/general"
import { usePostStore } from "@/app/stores/post"
import { useProfileStore } from "@/app/stores/profile"
import { PostWithProfile, ProfilePageTypes, User } from "@/app/types"
import { formatCount } from "@/app/utils/formatNumber"
import { showToast } from "@/app/utils/toast"
import { useCallback, useEffect, useState } from "react"
import { BsPencil } from "react-icons/bs"
import { FiShare } from "react-icons/fi"


const Profile = ({ params }: ProfilePageTypes) => {
    const contextUser = useUser()
    let { postsByUser, setPostsByUser } = usePostStore()
    let { setCurrentProfile, currentProfile } = useProfileStore()
    let { isEditProfileOpen, setIsEditProfileOpen } = useGeneralStore()
    const [followId, setFollowId] = useState<string | null>(null)
    const [followersCount, setFollowersCount] = useState<number>(0)
    const [followingCount, setFollowingCount] = useState<number>(0)
    const [likesCount, setLikesCount] = useState<number>(0)
    type ProfileTab = 'posts' | 'liked' | 'saved' | 'reposts'
    const [activeTab, setActiveTab] = useState<ProfileTab>('posts')
    const [likedPosts, setLikedPosts] = useState<PostWithProfile[]>([])
    const [savedPosts, setSavedPosts] = useState<PostWithProfile[]>([])
    const [repostedPosts, setRepostedPosts] = useState<PostWithProfile[]>([])
    const [isLoadingTab, setIsLoadingTab] = useState<boolean>(false)
    const isOwnProfile = contextUser?.user?.id == params?.id

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

    useEffect(() => {
        const fetchTabPosts = async () => {
            if (!params?.id || activeTab === 'posts') return

            setIsLoadingTab(true)
            try {
                if (activeTab === 'liked') {
                    setLikedPosts(await useGetLikedPosts(params.id))
                } else if (activeTab === 'reposts') {
                    setRepostedPosts(await useGetRepostedPosts(params.id))
                } else {
                    setSavedPosts(await useGetSavedPosts(params.id))
                }
            } catch (error) {
                console.error(error)
            } finally {
                setIsLoadingTab(false)
            }
        }
        fetchTabPosts()
    }, [activeTab, params?.id])

    // Saved is private to the profile owner; snap back if the viewer changes.
    useEffect(() => {
        if (activeTab === 'saved' && !isOwnProfile) {
            setActiveTab('posts')
        }
    }, [activeTab, isOwnProfile])

    const shareProfile = useCallback(async () => {
        const url = `${window.location.origin}/profile/${params.id}`
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({ title: `@${currentProfile?.name || 'profile'} on TikTok Clone`, url })
                return
            } catch {
                // Fall through to clipboard when the native sheet is dismissed/unavailable.
            }
        }
        try {
            await navigator.clipboard.writeText(url)
            showToast('Profile link copied')
        } catch {
            showToast('Could not copy link', 'error')
        }
    }, [currentProfile?.name, params.id])

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
        <div className="pt-[76px] md:pt-[90px] ml-0 md:ml-[90px] 2xl:pl-[185px] lg:pl-[160px] lg:pr-0 w-full md:w-[calc(100%-90px)] px-3 md:px-0 md:pr-3 pb-24 md:pb-6 max-w-[1800px] 2xl:mx-auto">

            <div className="flex w-full md:w-[calc(100vw-230px)]">

                <ClientOnly>
                    {currentProfile ? (
                        <img className="w-[120px] min-w-[120px] rounded-full" src={useCreateBucketUrl(currentProfile?.image)} />
                    ) : (
                        <div className="min-w-[150px] h-[120px] bg-surface-subtle rounded-full" />
                    )}
                </ClientOnly>

                <div className="ml-5 w-full">
                    <ClientOnly>
                        {(currentProfile as User)?.name ? (
                            <div>
                                <p className="text-[30px] text-ink font-bold truncate">{currentProfile?.name}</p>
                                <p className="text-[18px] text-ink-soft truncate">@{currentProfile?.name}</p>
                            </div>
                        ) : (
                            <div className="h-[60px]" />
                        )}
                    </ClientOnly>


                    <div className="flex items-center gap-2">
                        {isOwnProfile ? (
                            <button
                                onClick={() => setIsEditProfileOpen(isEditProfileOpen = !isEditProfileOpen)}
                                className="flex item-center rounded-md py-1.5 px-3.5 mt-3 text-[15px] font-semibold border border-line hover:bg-surface-subtle text-ink"
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
                        <button
                            onClick={shareProfile}
                            aria-label="Share profile"
                            className="mt-3 rounded-md border border-line p-2 text-ink hover:bg-surface-subtle"
                        >
                            <FiShare size={18} />
                        </button>
                    </div>
                </div>

            </div>

            <div className="flex items-center pt-4">
                <div className="mr-4">
                    <span className="font-bold text-ink">{formatCount(followingCount)}</span>
                    <span className="text-ink-soft font-light text-[15px] pl-1.5">Following</span>
                </div>
                <div className="mr-4">
                    <span className="font-bold text-ink">{formatCount(followersCount)}</span>
                    <span className="text-ink-soft font-light text-[15px] pl-1.5">Followers</span>
                </div>
                <div className="mr-4">
                    <span className="font-bold text-ink">{formatCount(likesCount)}</span>
                    <span className="text-ink-soft font-light text-[15px] pl-1.5">Likes</span>
                </div>
            </div>

            <ClientOnly>
                <p className="pt-4 mr-4 text-ink-soft font-light text-[15px] pl-1.5 max-w-[500px]">
                    {currentProfile?.bio}
                </p>
            </ClientOnly>

            <ul className="w-full flex items-center pt-4 border-b border-line">
                {([
                    { id: 'posts' as const, label: 'Posts' },
                    { id: 'liked' as const, label: 'Liked' },
                    ...(isOwnProfile ? [{ id: 'saved' as const, label: 'Saved' }] : []),
                    { id: 'reposts' as const, label: 'Reposts' },
                ]).map((tab) => (
                    <li
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-60 text-center py-2 text-[17px] font-semibold cursor-pointer ${activeTab === tab.id ? 'border-b-2 border-b-ink text-ink' : 'text-ink-soft'}`}
                    >
                        {tab.label}
                    </li>
                ))}
            </ul>

            <ClientOnly>
                <div className="mt-4 grid 2xl:grid-cols-6 xl:grid-cols-5 lg:grid-cols-4 md:grid-cols-3 grid-cols-2 gap-3">
                    {activeTab !== 'posts' && isLoadingTab ? (
                        <div className="flex justify-center items-center h-20 col-span-full">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink"></div>
                        </div>
                    ) : activeTab === 'liked' ? (
                        likedPosts.length > 0 ? (
                            likedPosts.map((post) => <PostUser key={post.id} post={post} />)
                        ) : (
                            <div className="text-ink-soft font-light text-[15px]">No liked posts yet</div>
                        )
                    ) : activeTab === 'saved' ? (
                        savedPosts.length > 0 ? (
                            savedPosts.map((post) => <PostUser key={post.id} post={post} />)
                        ) : (
                            <div className="text-ink-soft font-light text-[15px]">No saved posts yet</div>
                        )
                    ) : activeTab === 'reposts' ? (
                        repostedPosts.length > 0 ? (
                            repostedPosts.map((post) => <PostUser key={post.id} post={post} />)
                        ) : (
                            <div className="text-ink-soft font-light text-[15px]">No reposts yet</div>
                        )
                    ) : postsByUser?.length > 0 ? (
                        postsByUser.map((post) => <PostUser key={post.id} post={post} />)
                    ) : (
                        <div className="text-ink-soft font-light text-[15px]">No posts yet</div>
                    )}
                </div>
            </ClientOnly>

            <div className="pb-20" />
        </div>
        <MobileBottomNav />
    </MainLayout>
    </>
  )
}

export default Profile
