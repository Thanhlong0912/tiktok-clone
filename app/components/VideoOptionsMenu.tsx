import { useEffect, useRef, useState } from 'react'
import { HiDotsHorizontal } from 'react-icons/hi'
import AutoScrollToggle from './AutoScrollToggle'

type VideoOptionsMenuProps = {
  isAutoScrollEnabled: boolean
  onAutoScrollChange: (enabled: boolean) => void
  className?: string
  buttonClassName?: string
  panelClassName?: string
}

const VideoOptionsMenu = ({
  isAutoScrollEnabled,
  onAutoScrollChange,
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
          className={`absolute right-0 mt-2 w-[200px] rounded-xl border border-white/15 bg-[#2f2f34] p-2.5 text-white shadow-xl ${panelClassName}`}
        >
          <AutoScrollToggle
            enabled={isAutoScrollEnabled}
            onChange={onAutoScrollChange}
            className="w-full rounded-lg px-2 py-1.5 text-white"
            labelClassName="text-[15px] font-medium"
          />
        </div>
      ) : null}
    </div>
  )
}

export default VideoOptionsMenu
