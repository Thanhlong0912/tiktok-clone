"use client"

import ClientOnly from "./components/ClientOnly";
import PostMain from "./components/PostMain";
import MainLayout from "./layouts/MainLayOut";

export default function Home() {
  return (
    <>
    <MainLayout>
      <div className="mt-[80px]  w-[calc(100%-90px)] max-w-[690px] ml-auto">
        <ClientOnly>
          <PostMain post={{
            id: "123",
            user_id: '456',
            video_url: "https://firebasestorage.googleapis.com/v0/b/tiktok-569ce.appspot.com/o/Videos%2FVideos-3.mp4?alt=media&token=7f73751a-0b5b-4946-b391-9c80477e9f9e",
            text: 'longkhongmap',
            created_at: 'date here',
            profile: {
              user_id: '456',
              name: 'longbi',
              image: 'https://placehold.co/100'
            }
          }} />
        </ClientOnly>
      </div>
    </MainLayout>
    </>
  )
}
