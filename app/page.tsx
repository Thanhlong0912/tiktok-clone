"use client"

import { useEffect } from "react"
import { usePostStore } from "@/app/stores/post"
import ClientOnly from "./components/ClientOnly"
import PostMain from "./components/PostMain"
import MainLayout from "./layouts/MainLayout"
import { usePathname } from "next/navigation"

export default function Home() {

  const pathname = usePathname()

  let { allPosts, setAllPosts } = usePostStore();
  useEffect(() => { setAllPosts()}, [])

  return (
    <>
      <MainLayout>
        <div className="mt-[45px] w-full max-w-[690px] ml-auto">
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
