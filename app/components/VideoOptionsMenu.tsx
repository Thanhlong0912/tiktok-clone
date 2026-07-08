import { useEffect, useRef, useState } from 'react'
import { HiDotsHorizontal } from 'react-icons/hi'
import { FaRegCopy, FaRegFlag } from 'react-icons/fa'
import { FiExternalLink } from 'react-icons/fi'
import AutoScrollToggle from './AutoScrollToggle'
import { showToast } from '../utils/toast'

type VideoOptionsMenuProps = {
  isAutoScrollEnabled: boolean
  onAutoScrollChange: (enabled: boolean) => void
  /** When provided, the menu also offers Copy link and Report for this post. */
  postId?: string
  postUserId?: string
  /** When provided, "Go to post" replaces "Copy link" below the auto-scroll toggle. */
  onGoToPost?: () => void
  className?: string
  buttonClassName?: string
  panelClassName?: string
}

const VideoOptionsMenu = ({
  isAutoScrollEnabled,
  onAutoScrollChange,
  postId,
  postUserId,
  onGoToPost,
  className = '',
  buttonClassName = '',
  panelClassName = '',
}: VideoOptionsMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState<boolean>(false)

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return
    }

    const handleOutsideMenuClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null

      if (!menuRef.current || !target || menuRef.current.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideMenuClick)
    document.addEventListener('touchstart', handleOutsideMenuClick)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleOutsideMenuClick)
      document.removeEventListener('touchstart', handleOutsideMenuClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const copyPostLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/post/${postId}/${postUserId}`)
      showToast('Link copied to clipboard')
    } catch {
      showToast('Could not copy link', 'error')
    }
    setIsOpen(false)
  }

  const reportPost = () => {
    setIsOpen(false)
    showToast('Thanks for reporting. We’ll review this video.', 'info')
  }

  const hasPostActions = Boolean(postId && postUserId)

  return (
    <div ref={menuRef} className={`z-30 ${className}`}>
      <button
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setIsOpen((prev) => !prev)
        }}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border text-white transition-colors ${
          isOpen
            ? 'border-[#ffb703] bg-white/20'
            : 'border-transparent bg-black/45 hover:bg-black/60'
        } ${buttonClassName}`}
        aria-label="Open video options"
        aria-expanded={isOpen}
      >
        <HiDotsHorizontal size={21} />
      </button>

      {isOpen ? (
        <div
          className={`absolute right-0 mt-2 w-[210px] rounded-xl border border-white/15 bg-[#2f2f34] p-2.5 text-white shadow-xl ${panelClassName}`}
        >
          <AutoScrollToggle
            enabled={isAutoScrollEnabled}
            onChange={onAutoScrollChange}
            className="w-full rounded-lg px-2 py-1.5 text-white"
            labelClassName="text-[15px] font-medium"
          />

          {hasPostActions ? (
            <>
              {onGoToPost ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    setIsOpen(false)
                    onGoToPost()
                  }}
                  className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[15px] font-medium hover:bg-white/10"
                >
                  <FiExternalLink size={15} />
                  Go to post
                </button>
              ) : (
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    copyPostLink()
                  }}
                  className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[15px] font-medium hover:bg-white/10"
                >
                  <FaRegCopy size={15} />
                  Copy link
                </button>
              )}
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  reportPost()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[15px] font-medium text-[#ff7086] hover:bg-white/10"
              >
                <FaRegFlag size={15} />
                Report
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default VideoOptionsMenu
