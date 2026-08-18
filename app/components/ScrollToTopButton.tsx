"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { ChevronUp } from "lucide-react"

/**
 * Two things were wrong with this before.
 *
 * It faded to opacity-0 but stayed in the layout with pointer events live, so
 * an invisible button sat over the mobile bottom nav's Profile tab and ate
 * taps meant for it. It now unmounts instead of fading out.
 *
 * It also listened to window scroll, while the home feed scrolls inside its own
 * container -- so on `/`, the one page long enough to need it, it could never
 * appear. It is hidden there deliberately now: that feed has its own snap
 * navigation and arrow controls.
 */
const ScrollToTopButton = () => {
  const [isVisible, setIsVisible] = useState(false)
  const pathname = usePathname()
  const isFeed = pathname === '/'

  useEffect(() => {
    if (isFeed) {
      setIsVisible(false)
      return
    }

    const toggleVisibility = () => setIsVisible(window.scrollY > 500)

    toggleVisibility()
    window.addEventListener("scroll", toggleVisibility, { passive: true })

    return () => window.removeEventListener("scroll", toggleVisibility)
  }, [isFeed])

  if (!isVisible) return null

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "auto" })}
      aria-label="Scroll to top"
      // Clears the mobile bottom nav rather than overlapping it.
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+72px)] right-4 z-30 rounded-full bg-tiktok p-2.5 text-white shadow-rail transition-colors hover:bg-tiktok-hover md:bottom-6"
    >
      <ChevronUp size={20} />
    </button>
  )
}

export default ScrollToTopButton
