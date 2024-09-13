"use client"

import { useEffect, useState } from "react"
import { usePostStore } from "@/app/stores/post"
import ClientOnly from "./components/ClientOnly"
import PostMain from "./components/PostMain"
import MainLayout from "./layouts/MainLayout"
import { FaSpinner } from "react-icons/fa"

export default function Home() {
  const { allPosts, setAllPosts } = usePostStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        await setAllPosts() // Assuming setAllPosts is an async function
      } catch (error) {
        console.error("Failed to fetch posts:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchPosts()
  }, [setAllPosts])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <FaSpinner className="text-rose-400 animate-spin text-3xl" />
      </div>
    )
  }

  return (
    <MainLayout>
      <div className="mt-[45px] w-full max-w-[690px] ml-auto">
        <ClientOnly>
          {allPosts.map(post => (
            <PostMain post={post} key={post.id} />
          ))}
        </ClientOnly>
      </div>
    </MainLayout>
  )
}
