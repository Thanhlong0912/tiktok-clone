import { database, ID, Query } from '@/libs/AppWriteClient'

/**
 * Data layer for engagement features that don't yet have a dedicated Appwrite
 * collection in this project (Save/Bookmark and Repost).
 *
 * It is "Appwrite-first": if a collection id is provided via the matching env
 * var it reads/writes real documents (schema mirrors the Like collection:
 * a `user_id` string and a `post_id` string). If the env var is absent it
 * transparently falls back to localStorage so the feature works immediately
 * without backend changes.
 *
 * To fully wire to Appwrite, create a collection with `user_id` (string) and
 * `post_id` (string) attributes, then add its id to .env:
 *   NEXT_PUBLIC_COLLECTION_ID_SAVE='...'
 *   NEXT_PUBLIC_COLLECTION_ID_REPOST='...'
 */

export type InteractionKind = 'save' | 'repost'

export interface Interaction {
  id: string
  user_id: string
  post_id: string
}

const COLLECTION_ENV: Record<InteractionKind, string | undefined> = {
  save: process.env.NEXT_PUBLIC_COLLECTION_ID_SAVE,
  repost: process.env.NEXT_PUBLIC_COLLECTION_ID_REPOST,
}

const LOCAL_KEY: Record<InteractionKind, string> = {
  save: 'tt_local_saves',
  repost: 'tt_local_reposts',
}

export const INTERACTION_EVENT = 'tt-interaction-change'

// Once a remote call fails (missing collection, missing index, permissions...)
// stop hitting Appwrite for that kind this session and serve localStorage.
const remoteUnavailable: Partial<Record<InteractionKind, boolean>> = {}

function markRemoteUnavailable(kind: InteractionKind, error: unknown) {
  if (remoteUnavailable[kind]) return
  remoteUnavailable[kind] = true
  console.warn(
    `[interactions] Appwrite "${kind}" collection unavailable — falling back to local storage.`,
    error
  )
}

function collectionId(kind: InteractionKind): string | null {
  if (remoteUnavailable[kind]) return null
  const id = COLLECTION_ENV[kind]
  return id && id.length > 0 ? id : null
}

function notifyChange(kind: InteractionKind) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(INTERACTION_EVENT, { detail: { kind } }))
}

function readLocal(kind: InteractionKind): Interaction[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY[kind])
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocal(kind: InteractionKind, list: Interaction[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_KEY[kind], JSON.stringify(list))
  window.dispatchEvent(new CustomEvent(INTERACTION_EVENT, { detail: { kind } }))
}

export async function getInteractionsByPost(
  kind: InteractionKind,
  postId: string
): Promise<Interaction[]> {
  const cid = collectionId(kind)
  if (cid) {
    try {
      const res = await database.listDocuments(
        String(process.env.NEXT_PUBLIC_DATABASE_ID),
        cid,
        [Query.equal('post_id', postId)]
      )
      return res.documents.map((doc) => ({
        id: doc.$id,
        user_id: doc.user_id,
        post_id: doc.post_id,
      }))
    } catch (error) {
      markRemoteUnavailable(kind, error)
    }
  }
  return readLocal(kind).filter((i) => i.post_id === postId)
}

export async function getInteractionsByUser(
  kind: InteractionKind,
  userId: string
): Promise<Interaction[]> {
  const cid = collectionId(kind)
  if (cid) {
    try {
      const res = await database.listDocuments(
        String(process.env.NEXT_PUBLIC_DATABASE_ID),
        cid,
        [Query.equal('user_id', userId)]
      )
      return res.documents.map((doc) => ({
        id: doc.$id,
        user_id: doc.user_id,
        post_id: doc.post_id,
      }))
    } catch (error) {
      markRemoteUnavailable(kind, error)
    }
  }
  return readLocal(kind).filter((i) => i.user_id === userId)
}

export async function createInteraction(
  kind: InteractionKind,
  userId: string,
  postId: string
): Promise<string> {
  const cid = collectionId(kind)
  if (cid) {
    try {
      const res = await database.createDocument(
        String(process.env.NEXT_PUBLIC_DATABASE_ID),
        cid,
        ID.unique(),
        { user_id: userId, post_id: postId }
      )
      notifyChange(kind)
      return res.$id
    } catch (error) {
      markRemoteUnavailable(kind, error)
    }
  }

  const list = readLocal(kind)
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`
  list.push({ id, user_id: userId, post_id: postId })
  writeLocal(kind, list)
  return id
}

export async function deleteInteraction(
  kind: InteractionKind,
  id: string
): Promise<void> {
  const cid = collectionId(kind)
  if (cid && !id.startsWith('local_')) {
    try {
      await database.deleteDocument(
        String(process.env.NEXT_PUBLIC_DATABASE_ID),
        cid,
        id
      )
      notifyChange(kind)
      return
    } catch (error) {
      markRemoteUnavailable(kind, error)
    }
  }

  const list = readLocal(kind).filter((i) => i.id !== id)
  writeLocal(kind, list)
}
