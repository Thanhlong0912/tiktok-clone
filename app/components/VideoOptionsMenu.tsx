import { useEffect, useRef, useState } from 'react'
import { HiDotsHorizontal } from 'react-icons/hi'
import { FaRegCopy, FaRegFlag } from 'react-icons/fa'
import { FiExternalLink } from 'react-icons/fi'
import { IoClose } from 'react-icons/io5'
import { MdBlock } from 'react-icons/md'
import AutoScrollToggle from './AutoScrollToggle'
import ReasonSheet from './ReasonSheet'
import { showToast } from '../utils/toast'
import { markNotInterested, reportContent, REPORT_REASONS, type ReportReason } from '../utils/feed'
import { useUser } from '../context/user'
import { useGeneralStore } from '../stores/general'

type VideoOptionsMenuProps = {
  isAutoScrollEnabled: boolean
  onAutoScrollChange: (enabled: boolean) => void
  /** When provided, the menu also offers Copy link, Not interested and Report. */
  postId?: string
  postUserId?: string
  /** When provided, "Go to post" replaces "Copy link" below the auto-scroll toggle. */
  onGoToPost?: () => void
  /** Called after Not interested succeeds, so the feed can drop the card. */
  onNotInterested?: (postId: string) => void
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
  onNotInterested,
  className = '',
  buttonClassName = '',
  panelClassName = '',
}: VideoOptionsMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false)
  const [isReporting, setIsReporting] = useState<boolean>(false)
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()

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

  const handleNotInterested = async () => {
    setIsOpen(false)

    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    if (!postId) return

    try {
      await markNotInterested(postId)
      showToast('You will see fewer videos like this')
      onNotInterested?.(postId)
    } catch (error) {
      console.error(error)
      showToast('Could not save that preference', 'error')
    }
  }

  const openReport = () => {
    setIsOpen(false)

    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }

    setIsReportOpen(true)
  }

  const submitReport = async (reason: string) => {
    if (!postId || isReporting) return

    setIsReporting(true)
    try {
      await reportContent('post', postId, reason as ReportReason)
      setIsReportOpen(false)
      // report_content returns null when this user already reported the same
      // post. That is success, not failure -- acknowledge it either way.
      showToast('Thanks for reporting. Our team will review this video.')
    } catch (error: any) {
      console.error(error)
      showToast(
        error?.code === '54000'
          ? 'You have sent a lot of reports recently. Try again later.'
          : 'Could not send that report',
        'error'
      )
    } finally {
      setIsReporting(false)
    }
  }

  const hasPostActions = Boolean(postId && postUserId)

  return (
    <>
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
          aria-haspopup="menu"
        >
          <HiDotsHorizontal size={21} />
        </button>

        {isOpen ? (
          <div
            role="menu"
            className={`absolute right-0 mt-2 w-[230px] rounded-xl border border-white/15 bg-[#2f2f34] p-2.5 text-white shadow-xl ${panelClassName}`}
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
                    role="menuitem"
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
                    role="menuitem"
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
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleNotInterested()
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[15px] font-medium hover:bg-white/10"
                >
                  <MdBlock size={16} />
                  Not interested
                </button>

                <button
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation()
                    openReport()
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

      <ReasonSheet
        isOpen={isReportOpen}
        title="Report this video"
        description="Tell us what is wrong. Reports are reviewed by our moderation team."
        options={REPORT_REASONS}
        isSubmitting={isReporting}
        onSelect={submitReport}
        onClose={() => setIsReportOpen(false)}
      />
    </>
  )
}

export default VideoOptionsMenu
