import { useEffect, useRef } from 'react'
import { BiLoaderCircle } from 'react-icons/bi'
import { IoClose } from 'react-icons/io5'

type ReasonSheetProps = {
  isOpen: boolean
  title: string
  description?: string
  options: Array<{ value: string; label: string }>
  isSubmitting?: boolean
  onSelect: (value: string) => void
  onClose: () => void
}

/**
 * A modal list of reasons, used by Report.
 *
 * Kept as its own component because it is the first properly modal surface in
 * the app: it traps focus, closes on Escape, locks background scroll and
 * carries dialog semantics. The comment and share sheets predate it and do
 * none of that.
 */
const ReasonSheet = ({
  isOpen,
  title,
  description,
  options,
  isSubmitting = false,
  onSelect,
  onClose,
}: ReasonSheetProps) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return

    previouslyFocused.current = document.activeElement as HTMLElement | null

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      )

    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const items = focusable()
      if (items.length < 1) return

      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previouslyFocused.current?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 md:items-center">
      <button onClick={onClose} aria-label="Close" className="absolute inset-0" tabIndex={-1} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="tt-sheet-up relative max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4 text-ink shadow-[0_12px_48px_rgba(0,0,0,0.4)] md:w-[420px] md:rounded-2xl md:pb-4"
      >
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[17px] font-semibold">{title}</p>
          <button
            onClick={onClose}
            className="rounded-full bg-surface-subtle p-1 text-ink-soft hover:text-ink"
            aria-label="Close"
          >
            <IoClose size={22} />
          </button>
        </div>

        {description ? <p className="mb-3 text-[13px] text-ink-soft">{description}</p> : null}

        <div className="space-y-1">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => onSelect(option.value)}
              disabled={isSubmitting}
              className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[15px] font-medium hover:bg-surface-subtle disabled:opacity-60"
            >
              {option.label}
              {isSubmitting ? <BiLoaderCircle className="animate-spin" size={16} /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ReasonSheet
