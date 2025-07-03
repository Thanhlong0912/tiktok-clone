"use client"

import { useEffect, useState } from "react"
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

// Posts list component
const PostsList = ({ posts }: { posts: any[] }) => (
  <div className="mt-[45px] w-full max-w-[690px] ml-auto">
    <ClientOnly>
      {posts.map(post => (
        <PostMain post={post} key={post.id} />
      ))}
    </ClientOnly>
  </div>
)

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
