import { supabase } from '@/libs/supabase'
import { createBucketUrl } from '../hooks/useCreateBucketUrl'

/**
 * Subtitle tracks for a post.
 *
 * Captions are deliberately NOT part of public.feed_post: adding a field to that
 * composite type means dropping it with CASCADE and recreating all eight feed
 * RPCs, and the feed never renders a caption. They are looked up on demand
 * instead -- once per post per session, via the cache below -- the first time a
 * viewer opens the options menu or plays a card with captions already on.
 *
 * File validation lives in app/utils/captionFile.ts, which stays free of the
 * Supabase import so it can be unit tested.
 */

export interface PostCaption {
  lang: string
  label: string
  storage_key: string
}

/** A cached empty array is a real answer ("this post has none"), not a miss. */
const captionsByPost = new Map<string, PostCaption[]>()

export async function fetchPostCaptions(postId: string): Promise<PostCaption[]> {
  const cached = captionsByPost.get(postId)
  if (cached) {
    return cached
  }

  const { data, error } = await supabase
    .from('post_captions')
    .select('lang, label, storage_key')
    .eq('post_id', postId)
    .order('lang', { ascending: true })

  if (error) throw error

  const captions = (data as PostCaption[]) ?? []
  captionsByPost.set(postId, captions)
  return captions
}

/** Lets the uploader's own post show its new track without a reload. */
export function primePostCaptions(postId: string, captions: PostCaption[]) {
  captionsByPost.set(postId, captions)
}

/**
 * Fetches the .vtt and hands back a blob: URL.
 *
 * A <track> whose src is cross-origin is only read when the <video> carries
 * crossorigin="anonymous" -- and adding that attribute makes the VIDEO itself
 * fail to play if the bucket ever stops sending permissive CORS headers.
 * Copying the cues into a same-origin blob keeps that risk off the video
 * element entirely. The caller owns the URL and must revoke it.
 */
export async function createCaptionObjectUrl(storageKey: string): Promise<string> {
  const url = createBucketUrl(storageKey)
  if (!url) {
    throw new Error('Caption track has no resolvable storage url')
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Caption track request failed with ${response.status}`)
  }

  const text = await response.text()
  return URL.createObjectURL(new Blob([text], { type: 'text/vtt' }))
}
