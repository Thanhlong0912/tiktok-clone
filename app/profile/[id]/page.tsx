"use client"

import ClientOnly from "@/app/components/ClientOnly"
import PostUser from "@/app/components/profile/PostUser"
import { useUser } from "@/app/context/user"
import useCreateBucketUrl from "@/app/hooks/useCreateBucketUrl"
import useCreateFollow from "@/app/hooks/useCreateFollow"
import useDeleteFollow from "@/app/hooks/useDeleteFollow"
import useIsFollowing from "@/app/hooks/useIsFollowing"
import { fetchProfile, fetchUserPosts, type ProfileSummary } from "@/app/utils/feed"
import MainLayout from "@/app/layouts/MainLayout"
import MobileBottomNav from "@/app/components/MobileBottomNav"
import { useGeneralStore } from "@/app/stores/general"
import { usePostStore } from "@/app/stores/post"
import { PostWithProfile, ProfilePageTypes } from "@/app/types"
import { formatCount } from "@/app/utils/formatNumber"
import { showToast } from "@/app/utils/toast"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { BsPencil, BsPerson } from "react-icons/bs"
import { FiShare } from "react-icons/fi"
import { IoSettingsOutline } from "react-icons/io5"


const Profile = ({ params }: ProfilePageTypes) => {
    const contextUser = useUser()
    let { postsByUser, setPostsByUser, clearUserPosts } = usePostStore()
    const { isEditProfileOpen, setIsEditProfileOpen, setIsLoginOpen } = useGeneralStore()
    const [followId, setFollowId] = useState<string | null>(null)
    type ProfileTab = 'posts' | 'liked' | 'saved' | 'reposts'
    const [activeTab, setActiveTab] = useState<ProfileTab>('posts')
    const [likedPosts, setLikedPosts] = useState<PostWithProfile[]>([])
    const [savedPosts, setSavedPosts] = useState<PostWithProfile[]>([])
    const [repostedPosts, setRepostedPosts] = useState<PostWithProfile[]>([])
    const [isLoadingTab, setIsLoadingTab] = useState<boolean>(false)
    const [tabError, setTabError] = useState<boolean>(false)
    const isOwnProfile = contextUser?.user?.id == params?.id

    const [summary, setSummary] = useState<ProfileSummary | null>(null)
    const [statsError, setStatsError] = useState<boolean>(false)
    // get_profile returns no row for an id that is not a real account. Without
    // this the header sat on its skeleton forever, indistinguishable from a
    // slow load.
    const [isProfileMissing, setIsProfileMissing] = useState<boolean>(false)
    const [tabReloadKey, setTabReloadKey] = useState<number>(0)

    // One row from get_profile drives the whole header. The page previously
    // also pulled the same profile through useProfileStore, so every visit
    // fetched it twice.
    const currentProfile = summary
    const followersCount = summary?.follower_count ?? 0
    const followingCount = summary?.following_count ?? 0
    const likesCount = Number(summary?.total_likes ?? 0)

    // get_profile returns the profile, all three counts, the total like tally
    // and is_following in ONE row. This used to be three round trips plus one
    // likes query PER POST just to sum the like total -- a creator with 50
    // posts pulled every like row they had ever received on every page view.
    useEffect(() => {
        let active = true

        const loadSummary = async () => {
            if (!params?.id) return
            setStatsError(false)
            try {
                const result = await fetchProfile(params.id)
                if (!active) return
                setSummary(result)
                setIsProfileMissing(result === null)
            } catch (error) {
                console.error(error)
                if (active) setStatsError(true)
            }
        }

        loadSummary()
        return () => { active = false }
    }, [params?.id, followId])

    useEffect(() => {
        const checkFollow = async () => {
            if (!contextUser?.user?.id || !params?.id || contextUser.user.id === params?.id) return;
            const id = await useIsFollowing(contextUser.user.id, params.id);
            setFollowId(id);
        }
        checkFollow();
        setPostsByUser(params?.id)
    }, [contextUser?.user?.id, params?.id])

    /**
     * postsByUser is a single shared slot in the feed store, so navigating from
     * one profile to another rendered the PREVIOUS creator's grid until the new
     * fetch landed. Clearing on id change is what makes the skeleton honest.
     *
     * The tab caches are reset for the same reason.
     */
    useEffect(() => {
        clearUserPosts()
        setLikedPosts([])
        setSavedPosts([])
        setRepostedPosts([])
        setSummary(null)
        setIsProfileMissing(false)
        setFollowId(null)
        setActiveTab('posts')
    }, [params?.id, clearUserPosts])

    useEffect(() => {
        const fetchTabPosts = async () => {
            if (!params?.id || activeTab === 'posts') return

            setIsLoadingTab(true)
            setTabError(false)
            try {
                // One call each, and 'saved' is enforced server-side rather than
                // just hidden in the UI -- the rows were world-readable before.
                const posts = await fetchUserPosts(params.id, activeTab, null)
                if (activeTab === 'liked') setLikedPosts(posts)
                else if (activeTab === 'reposts') setRepostedPosts(posts)
                else setSavedPosts(posts)
            } catch (error) {
                console.error(error)
                // Previously swallowed, so a failed load rendered as
                // "No liked posts yet" -- indistinguishable from an empty tab.
                setTabError(true)
            } finally {
                setIsLoadingTab(false)
            }
        }
        fetchTabPosts()
        // tabReloadKey is what makes "Try again" work: re-selecting the tab that
        // is already active does not change activeTab, so the previous retry
        // button could never re-run this effect.
    }, [activeTab, params?.id, tabReloadKey])

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

    const [isFollowLoading, setIsFollowLoading] = useState<boolean>(false)

    const toggleFollow = useCallback(async () => {
        if (!contextUser?.user?.id) {
            setIsLoginOpen(true)
            return
        }
        if (!params?.id || isFollowLoading) return

        setIsFollowLoading(true)
        const previous = followId

        try {
            if (previous) {
                setFollowId(null)
                await useDeleteFollow(previous)
            } else {
                // useCreateFollow already returns the new row id; the old code
                // threw it away and issued a second query to read it back.
                const id = await useCreateFollow(contextUser.user.id, params.id)
                setFollowId(id)
            }
        } catch (error) {
            console.error(error)
            setFollowId(previous)
            showToast(previous ? 'Could not unfollow' : 'Could not follow', 'error')
        } finally {
            setIsFollowLoading(false)
        }
    }, [contextUser?.user?.id, followId, isFollowLoading, params?.id, setIsLoginOpen]);

  if (isProfileMissing) {
    return (
      <MainLayout>
        <div className="flex min-h-[70dvh] w-full flex-col items-center justify-center px-8 pt-[76px] text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
            <BsPerson size={32} />
          </div>
          <p className="mt-5 text-[20px] font-bold text-ink">Account not found</p>
          <p className="mt-2 max-w-xs text-[15px] text-ink-soft">
            This account doesn&apos;t exist, or it may have been removed.
          </p>
          <Link
            href="/explore"
            className="mt-5 rounded-md bg-tiktok px-6 py-2.5 text-[15px] font-semibold text-white hover:bg-tiktok-hover"
          >
            Discover creators
          </Link>
        </div>
        <MobileBottomNav />
      </MainLayout>
    )
  }

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
                        {currentProfile?.name ? (
                            <div>
                                <p className="text-[30px] text-ink font-bold truncate">{currentProfile?.name}</p>
                                <p className="text-[18px] text-ink-soft truncate">@{currentProfile?.handle}</p>
                            </div>
                        ) : (
                            <div className="h-[60px]" />
                        )}
                    </ClientOnly>


                    <div className="flex items-center gap-2">
                        {isOwnProfile ? (
                            <>
                                <button
                                    onClick={() => setIsEditProfileOpen(!isEditProfileOpen)}
                                    className="flex item-center rounded-md py-1.5 px-3.5 mt-3 text-[15px] font-semibold border border-line hover:bg-surface-subtle text-ink"
                                >
                                    <BsPencil className="mt-0.5 mr-1" size="18"/>
                                    <span>Edit profile</span>
                                </button>
                                {/* Where a block or a mute gets undone. Owner
                                    only -- the lists are scoped to auth.uid()
                                    server-side regardless. */}
                                <Link
                                    href="/settings/privacy"
                                    aria-label="Privacy settings"
                                    className="mt-3 rounded-md border border-line p-2 text-ink hover:bg-surface-subtle"
                                >
                                    <IoSettingsOutline size={18} />
                                </Link>
                            </>
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

            {/* The first two counts are links now. They rendered as plain text
                before, which made the social graph a dead end -- there was no
                way to get from a profile to the accounts around it. Likes stays
                text: there is no "who liked this creator" list to open. */}
            <div className="flex items-center pt-4">
                <Link href={`/profile/${params.id}/followers?tab=following`} className="mr-4 hover:underline">
                    <span className="font-bold text-ink">{formatCount(followingCount)}</span>
                    <span className="text-ink-soft font-light text-[15px] pl-1.5">Following</span>
                </Link>
                <Link href={`/profile/${params.id}/followers?tab=followers`} className="mr-4 hover:underline">
                    <span className="font-bold text-ink">{formatCount(followersCount)}</span>
                    <span className="text-ink-soft font-light text-[15px] pl-1.5">Followers</span>
                </Link>
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

            {/* Buttons in a tablist, not <li onClick>: the old markup could not
                be reached or activated by keyboard at all. */}
            <div role="tablist" aria-label="Profile content" className="w-full flex items-center pt-4 border-b border-line">
                {([
                    { id: 'posts' as const, label: 'Posts' },
                    { id: 'liked' as const, label: 'Liked' },
                    ...(isOwnProfile ? [{ id: 'saved' as const, label: 'Saved' }] : []),
                    { id: 'reposts' as const, label: 'Reposts' },
                ]).map((tab) => (
                    <button
                        key={tab.id}
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-60 text-center py-2 text-[17px] font-semibold transition-colors ${activeTab === tab.id ? 'border-b-2 border-b-ink text-ink' : 'text-ink-soft hover:text-ink'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <ClientOnly>
                <div className="mt-4 grid 2xl:grid-cols-6 xl:grid-cols-5 lg:grid-cols-4 md:grid-cols-3 grid-cols-2 gap-3">
                    {activeTab !== 'posts' && isLoadingTab ? (
                        <div className="flex justify-center items-center h-20 col-span-full">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink"></div>
                        </div>
                    ) : tabError ? (
                        <div className="col-span-full py-8 text-center">
                            <p className="text-[15px] font-semibold text-ink">Could not load these posts.</p>
                            <button
                                onClick={() => setTabReloadKey((key) => key + 1)}
                                className="mt-3 rounded-full bg-tiktok px-5 py-2 text-sm font-semibold text-white hover:bg-tiktok-hover"
                            >
                                Try again
                            </button>
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
