import type { Metadata } from 'next'
import { ProfilePageTypes } from '@/app/types'
import { fetchProfileCard, toMetadata } from '@/app/utils/metadataFetch'
import ProfileView from './ProfileView'

/** The profile half of the same shell -- see the note in the post route. */
export async function generateMetadata({ params }: ProfilePageTypes): Promise<Metadata> {
  return toMetadata(await fetchProfileCard(params.id), {
    title: 'Profile',
    description: 'See this creator on TikTok Clone.',
  })
}

export default function ProfilePage({ params }: ProfilePageTypes) {
  return <ProfileView params={params} />
}
