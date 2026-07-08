import Link from 'next/link';
import { useRouter } from 'next/navigation'
import { BiSearch, BiUser } from "react-icons/bi"
import { AiOutlinePlus } from "react-icons/ai"
import { BsHash, BsThreeDotsVertical } from "react-icons/bs"
import { FiLogOut } from "react-icons/fi"
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useUser } from '@/app/context/user';
import { useGeneralStore } from '@/app/stores/general';
import { usePostStore } from '@/app/stores/post';
import { RandomUsers } from '@/app/types';
import { debounce } from 'debounce';
import useSearchProfilesByName from '@/app/hooks/useSearchProfilesByName';
import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl';
import { searchTags } from '@/app/utils/postTags';
import ThemeToggle from './ThemeToggle';

const TopNav = () => {
  const userContext = useUser()
  const router = useRouter();

  const [searchProfiles, setSearchProfiles] = useState<RandomUsers[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showMenu, setShowMenu] = useState<boolean>(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  let { setIsLoginOpen, setIsEditProfileOpen } = useGeneralStore()
  const { allPosts } = usePostStore()

  // Tag autocomplete works off the cached feed; no extra requests.
  const tagSuggestions = useMemo(
    () => searchTags(allPosts, searchQuery, 4),
    [allPosts, searchQuery]
  )

  const clearSearch = () => {
    setSearchProfiles([])
    setSearchQuery('')
  }

  useEffect(() => { setIsEditProfileOpen(false) }, [])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const handleSearchName = debounce(async (event: { target: { value: string } }) => {
    if (event.target.value == "") return setSearchProfiles([])

    try {
        const result = await useSearchProfilesByName(event.target.value)
        if (result) return setSearchProfiles(result)
        setSearchProfiles([])
    } catch (error) {
        console.log(error)
        setSearchProfiles([])
    }
  }, 500)

  const goTo = () => {
    if (!userContext?.user) return setIsLoginOpen(true)
    router.push('/upload')
  }

  return (
    <div id="TopNav" className="fixed z-30 flex h-[60px] w-full items-center border-b border-line bg-surface">
      <div className={`mx-auto flex w-full items-center justify-between gap-4 px-4 `}>

        <Link href="/" className="shrink-0">
          <img className="w-[115px] min-w-[115px] dark:hidden" src="/images/tiktok-logo.png" alt="TikTok" />
          <img className="hidden w-[115px] min-w-[115px] dark:block" src="/images/tiktok-logo-white.png" alt="TikTok" />
        </Link>

        <div className="relative hidden w-full max-w-[430px] items-center rounded-full bg-surface-subtle md:flex">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              handleSearchName(event)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && searchQuery.trim()) {
                setSearchProfiles([])
                router.push(`/explore?q=${encodeURIComponent(searchQuery.trim())}`)
              }
            }}
            className="w-full bg-transparent py-2.5 pl-4 text-[15px] text-ink placeholder-ink-soft focus:outline-none"
            placeholder="Search accounts and videos"
          />

          {searchQuery.trim() && (searchProfiles.length > 0 || tagSuggestions.length > 0) ? (
            <div className="absolute left-0 top-[52px] z-20 w-full overflow-hidden rounded-xl border border-line bg-surface-elevated py-1 shadow-rail">
              {tagSuggestions.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    clearSearch()
                    router.push(`/explore?q=${encodeURIComponent(`#${tag}`)}`)
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-surface-subtle"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
                    <BsHash size={18} />
                  </span>
                  <span className="truncate text-[15px] font-medium text-ink">#{tag}</span>
                </button>
              ))}
              {searchProfiles.map((profile) => (
                <Link
                  key={profile.id}
                  href={`/profile/${profile?.id}`}
                  onClick={() => setSearchProfiles([])}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-subtle"
                >
                  <img className="h-9 w-9 rounded-full object-cover" src={useCreateBucketUrl(profile?.image)} alt={profile?.name} />
                  <span className="truncate text-[15px] font-medium text-ink">@{profile?.name}</span>
                </Link>
              ))}
              <button
                onClick={() => {
                  const q = searchQuery.trim()
                  clearSearch()
                  router.push(`/explore?q=${encodeURIComponent(q)}`)
                }}
                className="flex w-full items-center gap-2.5 border-t border-line px-3 py-2.5 text-[14px] font-semibold text-tiktok hover:bg-surface-subtle"
              >
                <BiSearch size={17} />
                View all results for “{searchQuery.trim()}”
              </button>
            </div>
          ) : null}

          <div className="border-l border-line px-4 py-1">
            <BiSearch className="text-ink-soft" size={22} />
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => goTo()}
            className="hidden items-center gap-1 rounded-md border border-line px-2.5 py-[7px] text-ink transition-colors hover:bg-surface-subtle md:flex"
          >
            <AiOutlinePlus size={20} />
            <span className="text-[15px] font-medium">Upload</span>
          </button>

          <ThemeToggle />

          {!userContext?.user?.id ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsLoginOpen(true)}
                className="whitespace-nowrap rounded-md bg-tiktok px-4 py-[7px] text-[15px] font-semibold text-white transition-colors hover:bg-tiktok-hover md:px-5"
              >
                Log in
              </button>
              <BsThreeDotsVertical className="hidden text-ink md:block" size={22} />
            </div>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="mt-1 rounded-full border border-line"
              >
                <img className="h-[35px] w-[35px] rounded-full object-cover" src={useCreateBucketUrl(userContext?.user?.image || '')} alt="Me" />
              </button>

              {showMenu ? (
                <div className="absolute right-0 top-[46px] w-[160px] overflow-hidden rounded-xl border border-line bg-surface-elevated py-1 text-ink shadow-rail">
                  <button
                    onClick={() => {
                      router.push(`/profile/${userContext?.user?.id}`)
                      setShowMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-3 hover:bg-surface-subtle"
                  >
                    <BiUser size={20} />
                    <span className="text-sm font-semibold">Profile</span>
                  </button>
                  <button
                    onClick={async () => {
                      await userContext?.logout()
                      setShowMenu(false)
                    }}
                    className="flex w-full items-center gap-2 border-t border-line px-3 py-3 hover:bg-surface-subtle"
                  >
                    <FiLogOut size={20} />
                    <span className="text-sm font-semibold">Log out</span>
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TopNav
