"use client"

import ClientOnly from '@/app/components/ClientOnly'
import Comments from '@/app/components/post/Comments'
import CommentsHeader from '@/app/components/post/CommentsHeader'
import { PostPageTypes } from '@/app/types'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import { AiOutlineClose } from "react-icons/ai"
import { BiChevronDown, BiChevronUp } from "react-icons/bi"

const Post = ({ params }: PostPageTypes) => {

  const postById  = {
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
  }

  const router = useRouter()

  const loopThroughPostsUp = () => {
    console.log('loopThroughPostsUp');
  }

  const loopThroughPostsDown = () => {
    console.log('loopThroughPostsDown');
  }
  return (
    <>
      <div
          id="PostPage"
          className="lg:flex justify-between w-full h-screen bg-black overflow-auto"
      >
          <div className="lg:w-[calc(100%-540px)] h-full relative">
              <Link
                  href={`/profile/${params?.userId}`}
                  className="absolute text-white z-20 m-5 rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
              >
                  <AiOutlineClose size="27"/>
              </Link>

              <div >
                  <button
                      onClick={() => loopThroughPostsUp()}
                      className="absolute z-20 right-4 top-[45%] flex items-center justify-center rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
                  >
                      <BiChevronUp size="30" color="#FFFFFF"/>
                  </button>

                  <button
                      onClick={() => loopThroughPostsDown()}
                      className="absolute z-20 right-4 top-[55%] flex items-center justify-center rounded-full bg-gray-700 p-1.5 hover:bg-gray-800"
                  >
                      <BiChevronDown size="30" color="#FFFFFF"/>
                  </button>
              </div>

              <img
                  className="absolute z-20 top-[18px] left-[70px] rounded-full lg:mx-0 mx-auto"
                  width="45"
                  src="/images/tiktok-logo-small.png"
              />

              <ClientOnly>
                  {postById?.video_url ? (
                      <video
                          className="fixed object-cover w-full my-auto z-[0] h-screen"
                          src="https://firebasestorage.googleapis.com/v0/b/tiktok-569ce.appspot.com/o/Videos%2FVideos-8.mp4?alt=media&token=ee7d0355-465d-4c5b-bb53-b537f075b5fd"
                      />
                  ) : null}

                  <div className="bg-black bg-opacity-70 lg:min-w-[480px] z-10 relative">
                      {true ? (
                          <video
                              autoPlay
                              controls
                              loop
                              muted
                              className="h-screen mx-auto"
                              src="https://firebasestorage.googleapis.com/v0/b/tiktok-569ce.appspot.com/o/Videos%2FVideos-8.mp4?alt=media&token=ee7d0355-465d-4c5b-bb53-b537f075b5fd"
                          />
                      ) : null}
                  </div>
              </ClientOnly>

          </div>

          <div id="InfoSection" className="lg:max-w-[550px] relative w-full h-full bg-white">
            <div className="py-7" />

                <ClientOnly>
                    {postById?.video_url ? (
                        <CommentsHeader post={postById} params={params}/>
                    ) : null}
                </ClientOnly>
                <Comments params={params}/>
          </div>
      </div>
    </>
  )
}

export default Post
