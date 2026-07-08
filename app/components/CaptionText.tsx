"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { resolveMentionUserId } from '../utils/mentions'
import { normalizeTag } from '../utils/postTags'

const TOKEN_SPLIT_REGEX = /([#@][^\s#@]+)/g

type CaptionTextProps = {
  text?: string | null
  className?: string
  /** Set false when rendered inside another link/button (nested links are invalid HTML). */
  linkify?: boolean
}

/** Links to the mentioned user's profile once resolved; account search until then. */
const MentionLink = ({ token }: { token: string }) => {
  const name = token.slice(1)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    resolveMentionUserId(name).then((id) => {
      if (active) setUserId(id)
    })

    return () => {
      active = false
    }
  }, [name])

  return (
    <Link
      href={userId ? `/profile/${userId}` : `/explore?q=${encodeURIComponent(name)}`}
      onClick={(event) => event.stopPropagation()}
      className="font-semibold hover:underline"
    >
      {token}
    </Link>
  )
}

/**
 * Renders a post caption with #hashtags and @mentions emphasized. Hashtags
 * link to Explore filtered by that tag; mentions link to the mentioned
 * user's profile (falling back to an Explore account search if the user
 * can't be resolved).
 */
const CaptionText = ({ text, className = '', linkify = true }: CaptionTextProps) => {
  if (!text) return null

  const parts = text.split(TOKEN_SPLIT_REGEX)

  return (
    <span className={className}>
      {parts.map((part, index) => {
        const isHashtag = /^#[^\s#@]+$/.test(part)
        const isMention = /^@[^\s#@]+$/.test(part)

        if (!isHashtag && !isMention) {
          return <span key={index}>{part}</span>
        }

        if (!linkify) {
          return (
            <span key={index} className="font-semibold">
              {part}
            </span>
          )
        }

        if (isMention) {
          return <MentionLink key={index} token={part} />
        }

        return (
          <Link
            key={index}
            href={`/explore?q=${encodeURIComponent(`#${normalizeTag(part)}`)}`}
            onClick={(event) => event.stopPropagation()}
            className="font-semibold hover:underline"
          >
            {part}
          </Link>
        )
      })}
    </span>
  )
}

export default CaptionText
