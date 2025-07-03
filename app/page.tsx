"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { usePostStore } from "@/app/stores/post"
import ClientOnly from "./components/ClientOnly"
import PostMain from "./components/PostMain"
import MainLayout from "./layouts/MainLayout"
import { FaSpinner } from "react-icons/fa"

// Custom hook for posts data fetching
const usePosts = () => {
  const { allPosts, setAllPosts } = usePostStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        setError(null)
        await setAllPosts()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch posts"
        console.error("Failed to fetch posts:", err)
        setError(errorMessage)
      } finally {
        setLoading(false)
      }
    }

    fetchPosts()
  }, [setAllPosts])

  return { allPosts, loading, error }
}

// Loading spinner component
const LoadingSpinner = () => (
  <div className="flex justify-center items-center h-screen">
    <FaSpinner className="text-rose-400 animate-spin text-3xl" />
  </div>
)

// Error display component
const ErrorDisplay = ({ error }: { error: string }) => (
  <div className="flex justify-center items-center h-screen">
    <div className="text-red-500 text-center">
      <p className="text-lg mb-2">Something went wrong</p>
      <p className="text-sm opacity-75">{error}</p>
    </div>
  </div>
)

// Posts list component with scroll navigation
const PostsList = ({ posts }: { posts: any[] }) => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const isScrolling = useRef(false)
  const scrollTimeout = useRef<NodeJS.Timeout>()

  // Smooth scroll to specific post
  const scrollToPost = useCallback((index: number) => {
    const container = containerRef.current
    if (!container) return

    const postElements = container.querySelectorAll('[data-post-index]')
    const targetElement = postElements[index] as HTMLElement

    if (targetElement) {
      targetElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }, [])

  // Handle wheel scroll
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()

    if (isScrolling.current) return

    const deltaY = e.deltaY
    const scrollThreshold = 50 // Minimum scroll distance to trigger navigation

    if (Math.abs(deltaY) < scrollThreshold) return

    isScrolling.current = true

    if (deltaY > 0) {
      // Scroll down - next video
      setCurrentIndex(prev => {
        const nextIndex = Math.min(prev + 1, posts.length - 1)
        scrollToPost(nextIndex)
        return nextIndex
      })
    } else {
      // Scroll up - previous video
      setCurrentIndex(prev => {
        const prevIndex = Math.max(prev - 1, 0)
        scrollToPost(prevIndex)
        return prevIndex
      })
    }

    // Reset scrolling flag after animation
    clearTimeout(scrollTimeout.current)
    scrollTimeout.current = setTimeout(() => {
      isScrolling.current = false
    }, 800) // Adjust timing based on your scroll animation duration

  }, [posts.length, scrollToPost])

  // Handle keyboard navigation (optional)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCurrentIndex(prev => {
        const nextIndex = Math.min(prev + 1, posts.length - 1)
        scrollToPost(nextIndex)
        return nextIndex
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCurrentIndex(prev => {
        const prevIndex = Math.max(prev - 1, 0)
        scrollToPost(prevIndex)
        return prevIndex
      })
    }
  }, [posts.length, scrollToPost])

  // Set up event listeners
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Add wheel event listener
    container.addEventListener('wheel', handleWheel, { passive: false })

    // Add keyboard event listener
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('wheel', handleWheel)
      document.removeEventListener('keydown', handleKeyDown)
      clearTimeout(scrollTimeout.current)
    }
  }, [handleWheel, handleKeyDown])

  // Handle intersection observer for auto-updating current index
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const index = parseInt(entry.target.getAttribute('data-post-index') || '0')
            setCurrentIndex(index)
          }
        })
      },
      {
        threshold: 0.5,
        rootMargin: '-10% 0px -10% 0px' // Only trigger when post is well within viewport
      }
    )

    const postElements = container.querySelectorAll('[data-post-index]')
    postElements.forEach((element) => observer.observe(element))

    return () => observer.disconnect()
  }, [posts])

  return (
    <div
      ref={containerRef}
      className="w-full max-w-[690px] ml-auto h-screen overflow-hidden relative"
    >
      <ClientOnly>
        {posts.map((post, index) => (
          <div
            key={post.id}
            data-post-index={index}
            className={`transition-opacity duration-300 pt-[45px] ${
              index === currentIndex ? 'opacity-100' : 'opacity-50'
            }`}
          >
            <PostMain post={post} />
          </div>
        ))}
      </ClientOnly>

      {/* Optional: Navigation indicators */}
      <div className="fixed right-4 top-1/2 transform -translate-y-1/2 flex flex-col gap-2 z-10">
        {posts.map((_, index) => (
          <button
            key={index}
            onClick={() => {
              setCurrentIndex(index)
              scrollToPost(index)
            }}
            className={`w-2 h-2 rounded-full transition-colors ${
              index === currentIndex ? 'bg-rose-500' : 'bg-gray-300'
            }`}
            aria-label={`Go to post ${index + 1}`}
          />
        ))}
      </div>
    </div>
  )
}

// Empty state component
const EmptyState = () => (
  <div className="flex justify-center items-center h-screen">
    <div className="text-gray-500 text-center">
      <p className="text-lg">No posts available</p>
      <p className="text-sm opacity-75">Check back later for new content</p>
    </div>
  </div>
)

// Main component
export default function Home() {
  const { allPosts, loading, error } = usePosts()

  if (loading) {
    return <LoadingSpinner />
  }

  if (error) {
    return <ErrorDisplay error={error} />
  }

  if (!allPosts || allPosts.length === 0) {
    return (
      <MainLayout>
        <EmptyState />
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <PostsList posts={allPosts} />
    </MainLayout>
  )
}
