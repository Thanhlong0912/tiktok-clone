import { useEffect, useRef, useState } from 'react'
import { HiDotsHorizontal } from 'react-icons/hi'
import { FaRegCopy, FaRegFlag } from 'react-icons/fa'
import { FiExternalLink } from 'react-icons/fi'
import { GoArrowUp } from 'react-icons/go'
import {
  MdArrowBack,
  MdBlock,
  MdCheck,
  MdChevronRight,
  MdHd,
  MdOutlineClosedCaption,
  MdOutlineSpeed,
  MdPersonOff,
  MdPictureInPictureAlt,
  MdVolumeOff,
} from 'react-icons/md'
import AutoScrollToggle from './AutoScrollToggle'
import ReasonSheet from './ReasonSheet'
import { showToast } from '../utils/toast'
import { blockUser, markNotInterested, muteUser, reportContent, REPORT_REASONS, type ReportReason } from '../utils/feed'
import { useUser } from '../context/user'
import { useGeneralStore } from '../stores/general'
import {
  getVideoSpeed,
  PLAYBACK_SPEEDS,
  setVideoSpeed,
  subscribeToVideoSpeed,
  type PlaybackSpeed,
} from '../utils/videoSpeedPreference'

/** 'unknown' until the parent has looked the post's tracks up. */
export type CaptionsState = 'unknown' | 'none' | 'available'

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
  /** Image posts have no video element: Quality, Floating Player and Captions
   *  are hidden for them, while Speed still drives the slideshow. */
  mediaKind?: 'video' | 'image'
  /** Source resolution, e.g. "1080P". Null hides the row -- posts uploaded
   *  before width/height were captured have nothing to report. */
  qualityLabel?: string | null
  isFloatingPlayerSupported?: boolean
  isFloatingPlayerActive?: boolean
  onToggleFloatingPlayer?: () => void
  captionsState?: CaptionsState
  isCaptionsEnabled?: boolean
  onCaptionsChange?: (enabled: boolean) => void
  /** Lets the parent lazily load captions the first time the menu is opened. */
  onOpenChange?: (isOpen: boolean) => void
  className?: string
  buttonClassName?: string
  panelClassName?: string
}

const rowClassName =
  'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[15px] font-medium hover:bg-white/10'

const VideoOptionsMenu = ({
  isAutoScrollEnabled,
  onAutoScrollChange,
  postId,
  postUserId,
  onGoToPost,
  onNotInterested,
  mediaKind = 'video',
  qualityLabel = null,
  isFloatingPlayerSupported = false,
  isFloatingPlayerActive = false,
  onToggleFloatingPlayer,
  captionsState = 'unknown',
  isCaptionsEnabled = false,
  onCaptionsChange,
  onOpenChange,
  className = '',
  buttonClassName = '',
  panelClassName = '',
}: VideoOptionsMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [activePanel, setActivePanel] = useState<'main' | 'quality'>('main')
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false)
  const [isReporting, setIsReporting] = useState<boolean>(false)
  const [isBlocking, setIsBlocking] = useState<boolean>(false)
  const [isMuting, setIsMuting] = useState<boolean>(false)
  const { user } = useUser() || {}
  const { setIsLoginOpen } = useGeneralStore()

  const isVideoPost = mediaKind !== 'image'

  // Speed is read straight from the preference rather than passed in: every
  // player subscribes to the same store, so the menu does not need an owner.
  useEffect(() => {
    setSpeed(getVideoSpeed())
    return subscribeToVideoSpeed(setSpeed)
  }, [])

  const changeMenuOpen = (next: boolean) => {
    setIsOpen(next)
    if (!next) setActivePanel('main')
    onOpenChange?.(next)
  }

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return
    }

    const handleOutsideMenuClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null

      if (!menuRef.current || !target || menuRef.current.contains(target)) {
        return
      }

      changeMenuOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        changeMenuOpen(false)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const copyPostLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/post/${postId}/${postUserId}`)
      showToast('Link copied to clipboard')
    } catch {
      showToast('Could not copy link', 'error')
    }
    changeMenuOpen(false)
  }

  const handleNotInterested = async () => {
    changeMenuOpen(false)

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
    changeMenuOpen(false)

    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }

    setIsReportOpen(true)
  }

  /**
   * Blocks are already filtered out of every feed, search, profile and
   * notification RPC -- this is the write side those filters never had, so the
   * table could only ever be empty.
   */
  const handleBlock = async () => {
    changeMenuOpen(false)

    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    if (!postUserId || isBlocking) return

    setIsBlocking(true)
    try {
      await blockUser(postUserId)
      showToast('Blocked. You will not see their videos again.')
      // Same removal path as Not interested: the card is filtered server-side
      // from here on, but the copy already on screen has to go now.
      onNotInterested?.(postId ?? '')
    } catch (error) {
      console.error(error)
      showToast((error as Error)?.message || 'Could not block this account', 'error')
    } finally {
      setIsBlocking(false)
    }
  }

  /**
   * The softer half of the block pair, and it had the same problem: get_feed
   * has filtered public.mutes since 0002 but nothing ever wrote a row, so the
   * filter ran against an empty set.
   *
   * The copy is deliberately narrower than Block's. A mute is honoured by
   * get_feed and by the comment reads, and NOT by get_following_feed, search
   * or the creator's own profile -- so promising "you will not see them again"
   * would be a promise the schema does not keep.
   */
  const handleMute = async () => {
    changeMenuOpen(false)

    if (!user?.id) {
      setIsLoginOpen(true)
      return
    }
    if (!postUserId || isMuting) return

    setIsMuting(true)
    try {
      await muteUser(postUserId)
      showToast('Muted. You will not see them in For You.')
      onNotInterested?.(postId ?? '')
    } catch (error) {
      console.error(error)
      showToast((error as Error)?.message || 'Could not mute this account', 'error')
    } finally {
      setIsMuting(false)
    }
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

  const toggleCaptions = () => {
    if (captionsState === 'none') {
      showToast('No captions for this video')
      return
    }

    onCaptionsChange?.(!isCaptionsEnabled)
  }

  const toggleFloatingPlayer = () => {
    changeMenuOpen(false)
    onToggleFloatingPlayer?.()
  }

  const hasPostActions = Boolean(postId && postUserId)
  const showQuality = isVideoPost && Boolean(qualityLabel)
  const showFloatingPlayer = isVideoPost && isFloatingPlayerSupported && Boolean(onToggleFloatingPlayer)
  const showCaptions = isVideoPost && Boolean(onCaptionsChange)

  return (
    <>
      <div ref={menuRef} className={`z-30 ${className}`}>
        <button
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            changeMenuOpen(!isOpen)
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
            className={`absolute right-0 mt-2 w-[264px] rounded-xl border border-white/15 bg-[#2f2f34] p-2.5 text-white shadow-xl ${panelClassName}`}
          >
            {activePanel === 'quality' ? (
              <>
                <button
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation()
                    setActivePanel('main')
                  }}
                  className={rowClassName}
                >
                  <MdArrowBack size={17} />
                  Quality
                </button>

                <div className="mt-1 border-t border-white/10 pt-1">
                  {/*
                    Every post is stored as a single file -- there are no
                    transcoded renditions to switch between -- so this lists
                    what actually exists rather than offering ladder rungs that
                    would all resolve to the same source.
                  */}
                  <div className={`${rowClassName} justify-between`}>
                    <span>Auto</span>
                    <MdCheck size={18} className="text-[#5fd4ee]" />
                  </div>
                  <div className={`${rowClassName} justify-between text-white/70`}>
                    <span>{qualityLabel}</span>
                    <span className="text-[13px]">Source</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
                  <span className="flex items-center gap-2.5 text-[15px] font-medium">
                    <MdOutlineSpeed size={18} />
                    Speed
                  </span>
                  <div role="radiogroup" aria-label="Playback speed" className="flex items-center gap-0.5 rounded-full bg-black/40 p-0.5">
                    {PLAYBACK_SPEEDS.map((option) => (
                      <button
                        key={option}
                        role="radio"
                        aria-checked={speed === option}
                        onClick={(event) => {
                          event.stopPropagation()
                          setVideoSpeed(option)
                        }}
                        className={`rounded-full px-1.5 py-0.5 text-[12px] font-semibold transition-colors ${
                          speed === option ? 'bg-white text-black' : 'text-white/80 hover:text-white'
                        }`}
                      >
                        {option === 1 ? '1.0' : option}
                      </button>
                    ))}
                  </div>
                </div>

                {showQuality ? (
                  <button
                    role="menuitem"
                    onClick={(event) => {
                      event.stopPropagation()
                      setActivePanel('quality')
                    }}
                    className={`${rowClassName} justify-between`}
                  >
                    <span className="flex items-center gap-2.5">
                      <MdHd size={19} />
                      Quality
                    </span>
                    <span className="flex items-center gap-0.5 text-[14px] text-white/70">
                      {qualityLabel}
                      <MdChevronRight size={17} />
                    </span>
                  </button>
                ) : null}

                <AutoScrollToggle
                  enabled={isAutoScrollEnabled}
                  onChange={onAutoScrollChange}
                  icon={<GoArrowUp size={17} />}
                  className="w-full rounded-lg px-2 py-2 text-white hover:bg-white/10"
                  labelClassName="text-[15px] font-medium"
                />

                {showFloatingPlayer ? (
                  <button
                    role="menuitem"
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleFloatingPlayer()
                    }}
                    className={rowClassName}
                  >
                    <MdPictureInPictureAlt size={17} />
                    {isFloatingPlayerActive ? 'Exit Floating Player' : 'Floating Player'}
                  </button>
                ) : null}

                {showCaptions ? (
                  <button
                    role="menuitem"
                    aria-pressed={isCaptionsEnabled}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleCaptions()
                    }}
                    className={`${rowClassName} justify-between ${
                      captionsState === 'none' ? 'text-white/40' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <MdOutlineClosedCaption size={19} />
                      Captions
                    </span>
                    <span className="text-[13px] text-white/60">
                      {captionsState === 'none'
                        ? 'None'
                        : isCaptionsEnabled
                          ? 'On'
                          : captionsState === 'unknown'
                            ? ''
                            : 'Off'}
                    </span>
                  </button>
                ) : null}

                {hasPostActions ? (
                  <>
                    {onGoToPost ? (
                      <button
                        role="menuitem"
                        onClick={(event) => {
                          event.stopPropagation()
                          changeMenuOpen(false)
                          onGoToPost()
                        }}
                        className={rowClassName}
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
                        className={rowClassName}
                      >
                        <FaRegCopy size={15} />
                        Copy link
                      </button>
                    )}

                    <div className="my-1 border-t border-white/10" />

                    <button
                      role="menuitem"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleNotInterested()
                      }}
                      className={rowClassName}
                    >
                      <MdBlock size={16} />
                      Not interested
                    </button>

                    {/* Only for someone else's video: blocking or muting
                        yourself is rejected by a check constraint anyway. */}
                    {postUserId && user?.id !== postUserId ? (
                      <>
                        <button
                          role="menuitem"
                          disabled={isMuting}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleMute()
                          }}
                          className={`${rowClassName} disabled:opacity-60`}
                        >
                          <MdVolumeOff size={17} />
                          Mute this account
                        </button>

                        <button
                          role="menuitem"
                          disabled={isBlocking}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleBlock()
                          }}
                          className={`${rowClassName} disabled:opacity-60`}
                        >
                          <MdPersonOff size={17} />
                          Block this account
                        </button>
                      </>
                    ) : null}

                    <button
                      role="menuitem"
                      onClick={(event) => {
                        event.stopPropagation()
                        openReport()
                      }}
                      className={`${rowClassName} text-[#ff7086]`}
                    >
                      <FaRegFlag size={15} />
                      Report
                    </button>
                  </>
                ) : null}
              </>
            )}
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
