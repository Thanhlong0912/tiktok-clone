"use client"

import { useEffect } from "react";
import ClientOnly from "./components/ClientOnly";
import PostMain from "./components/PostMain";
import MainLayout from "./layouts/MainLayOut";
import { usePostStore } from "./stores/post";

export default function Home() {

  let { allPosts, setAllPosts } = usePostStore();
  useEffect(() => { setAllPosts()}, [])

  return (
    <>
    <MainLayout>
      <div className="mt-[80px]  w-[calc(100%-90px)] max-w-[690px] ml-auto">
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
