import React, { useEffect, useState } from 'react'
import { FaMoon } from 'react-icons/fa'
import { BsSunFill } from 'react-icons/bs'

const THEME_CHANGE_EVENT = 'tt-theme-change'

/** Reads the theme the inline script in layout.tsx already applied. */
const readAppliedTheme = () => {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

export const setTheme = (isDark: boolean) => {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  root.classList.toggle('dark', isDark)
  // Keeps native scrollbars, form controls and the address bar in step.
  root.style.colorScheme = isDark ? 'dark' : 'light'

  try {
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  } catch {
    // Private mode. The class above still applies for this session.
  }

  window.dispatchEvent(new CustomEvent<boolean>(THEME_CHANGE_EVENT, { detail: isDark }))
}

export const subscribeToTheme = (onChange: (isDark: boolean) => void) => {
  if (typeof window === 'undefined') return () => {}

  const handler = (event: Event) => onChange(Boolean((event as CustomEvent<boolean>).detail))
  window.addEventListener(THEME_CHANGE_EVENT, handler)
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler)
}

type ThemeToggleProps = {
  className?: string
  /**
   * 'overlay' is the icon-only form used over the immersive mobile feed, which
   * hides the top nav entirely -- without it the theme could only be changed by
   * first navigating away from the feed, which on a phone is the whole app.
   */
  variant?: 'switch' | 'overlay'
}

/**
 * A real switch, not a div.
 *
 * The previous version was a <div onClick>: unfocusable, with no role and no
 * pressed state, so it was unusable by keyboard and invisible to assistive
 * tech. Its knob also animated via `left`/`right` under a
 * `transition-transform`, which animates neither -- the motion never happened.
 *
 * Initial state is read from the class the inline script already set rather
 * than from localStorage, so the button and the document can never disagree.
 */
const ThemeToggle = ({ className = '', variant = 'switch' }: ThemeToggleProps) => {
  const [isDark, setIsDark] = useState<boolean>(false)

  useEffect(() => {
    setIsDark(readAppliedTheme())
    return subscribeToTheme(setIsDark)
  }, [])

  if (variant === 'overlay') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label="Dark mode"
        onClick={() => setTheme(!isDark)}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/60 ${className}`}
      >
        {isDark ? <FaMoon size={15} /> : <BsSunFill size={15} />}
      </button>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark mode"
      onClick={() => setTheme(!isDark)}
      className={`relative flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors bg-yellow-200 dark:bg-cyan-800 ${className}`}
    >
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-yellow-600 shadow-md transition-transform duration-300 dark:bg-blue-500 ${
          isDark ? 'translate-x-6' : 'translate-x-0'
        }`}
      >
        {isDark ? (
          <FaMoon className="text-white" size={14} />
        ) : (
          <BsSunFill className="text-white" size={14} />
        )}
      </span>
    </button>
  )
}

export default ThemeToggle
