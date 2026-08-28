import type { Metadata } from 'next'
import { PostPageTypes } from '@/app/types'
import { fetchPostCard, toMetadata } from '@/app/utils/metadataFetch'
import PostDetail from './PostDetail'

/**
 * A server shell whose only job is the link preview.
 *
 * PostDetail below is the same client component this route has always been --
 * it is not rendered on the server in any meaningful sense, and every byte of
 * its data still comes from the browser. What this file adds is the one thing
 * a client component cannot produce: tags in the <head> that a crawler can
 * read, so a pasted post link unfurls as the post rather than as the app.
 */
export async function generateMetadata({ params }: PostPageTypes): Promise<Metadata> {
  return toMetadata(await fetchPostCard(params.postId), {
    title: 'Video',
    description: 'Watch this video on TikTok Clone.',
  })
}

export default function PostPage({ params }: PostPageTypes) {
  return <PostDetail params={params} />
}
