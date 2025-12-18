"use client"

import { usePostStore } from "@/app/stores/post"
import { useEffect } from "react"
import ClientOnly from "./components/ClientOnly"
import PostMain from "./components/PostMain"
import MainLayout from "./layouts/MainLayout"

export default function Home() {
  let { allPosts, setAllPosts } = usePostStore();
  useEffect(() => { setAllPosts()}, [])

  return (
    <>
      <MainLayout>
        <div className="mt-[60px] w-full max-w-[690px] ml-auto h-[calc(100vh-60px)] overflow-y-scroll snap-y snap-mandatory scroll-smooth no-scrollbar">
          <ClientOnly>
            {allPosts.map((post, index) => (
              <PostMain post={post} key={index} />
            ))}
          </ClientOnly>
        </div>
      </MainLayout>
    </>
  )
}
