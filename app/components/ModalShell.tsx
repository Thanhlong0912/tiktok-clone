'use client'

import { ReactNode, useEffect, useRef } from 'react'

type ModalShellProps = {
  isOpen: boolean
  /** Accessible name for the dialog. */
  label: string
  onClose: () => void
  /** Applied to the panel, so each caller keeps its own width and chrome. */
  className?: string
  /** Set false for a sheet that must not be dismissed by clicking away. */
  closeOnBackdrop?: boolean
  children: ReactNode
}

/**
 * The modal behaviour every overlay in the app should have had.
 *
 * Extracted from ReasonSheet, which was the only surface that implemented it:
 * Escape to close, a focus trap, background scroll lock, focus restored to
 * whatever opened it, and real dialog semantics. AuthOverlay and the rest had
 * none of that -- keyboard users could tab straight out of the login sheet into
 * the page behind it, and the page kept scrolling underneath.
 */
const ModalShell = ({
  isOpen,
  label,
  onClose,
  className = '',
  closeOnBackdrop = true,
  children,
}: ModalShellProps) => {
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
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.offsetParent !== null)

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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3">
      {closeOnBackdrop ? (
        <button onClick={onClose} aria-label="Close" className="absolute inset-0" tabIndex={-1} />
      ) : null}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`relative flex flex-col bg-surface text-ink shadow-[0_12px_48px_rgba(0,0,0,0.4)] ${className}`}
      >
        {children}
      </div>
    </div>
  )
}

export default ModalShell
