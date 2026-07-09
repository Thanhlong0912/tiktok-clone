"use client"

import { debounce } from 'debounce'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BsHash } from 'react-icons/bs'
import { HiOutlineAtSymbol } from 'react-icons/hi'
import { useUser } from '../../context/user'
import useCreateBucketUrl from '../../hooks/useCreateBucketUrl'
import useGetRandomUsers from '../../hooks/useGetRandomUsers'
import useSearchProfilesByName from '../../hooks/useSearchProfilesByName'
import { usePostStore } from '../../stores/post'
import { RandomUsers } from '../../types'
import { foldName, rememberMention } from '../../utils/mentions'
import { getTrendingTags, searchTags } from '../../utils/postTags'

type ActiveToken = {
  start: number
  end: number
  kind: 'hashtag' | 'mention'
  query: string
}

type CaptionComposerProps = {
  value: string
  onChange: (value: string) => void
  maxLength?: number
  placeholder?: string
}

// The token being typed at the caret, e.g. "#da" or "@long".
function tokenAtCaret(text: string, caret: number): ActiveToken | null {
  const before = text.slice(0, caret)
  const match = before.match(/(?:^|\s)([#@][^\s#@]*)$/)
  if (!match) return null

  const token = match[1]
  return {
    start: caret - token.length,
    end: caret,
    kind: token[0] === '#' ? 'hashtag' : 'mention',
    query: token.slice(1),
  }
}

/**
 * TikTok-style caption field: hashtags/mentions are highlighted as you type
 * (a styled overlay sits behind a transparent-text textarea), the # / @
 * buttons insert the symbol at the caret, and matching tags/accounts are
 * suggested for the token being typed.
 */
const CaptionComposer = ({
  value,
  onChange,
  maxLength = 150,
  placeholder = 'Share what this post is about...',
}: CaptionComposerProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const { allPosts } = usePostStore()
  const contextUser = useUser()
  const [activeToken, setActiveToken] = useState<ActiveToken | null>(null)
  const [candidateUsers, setCandidateUsers] = useState<RandomUsers[]>([])
  const [remoteMentionResults, setRemoteMentionResults] = useState<RandomUsers[]>([])

  // Users offered as soon as "@" is typed: creators from the cached feed
  // plus a handful from the profile collection.
  useEffect(() => {
    let active = true

    const loadCandidates = async () => {
      const seen: Record<string, boolean> = {}
      const merged: RandomUsers[] = []

      allPosts.forEach((post) => {
        const profile = post.profile
        if (profile?.user_id && !seen[profile.user_id]) {
          seen[profile.user_id] = true
          merged.push({ id: profile.user_id, name: profile.name, image: profile.image })
        }
      })

      try {
        const random = (await useGetRandomUsers()) || []
        random.forEach((user) => {
          if (user?.id && !seen[user.id]) {
            seen[user.id] = true
            merged.push(user)
          }
        })
      } catch {
        // Feed profiles alone are still a useful list.
      }

      if (active) setCandidateUsers(merged)
    }

    loadCandidates()

    return () => {
      active = false
    }
  }, [allPosts])

  const syncActiveToken = () => {
    const el = textareaRef.current
    if (!el || el.selectionStart !== el.selectionEnd) {
      setActiveToken(null)
      return
    }
    setActiveToken(tokenAtCaret(el.value, el.selectionStart))
  }

  const tagSuggestions = useMemo(() => {
    if (activeToken?.kind !== 'hashtag') return []
    return activeToken.query
      ? searchTags(allPosts, activeToken.query, 5)
      : getTrendingTags(allPosts, 5)
  }, [activeToken, allPosts])

  const searchMentions = useMemo(
    () =>
      debounce(async (query: string) => {
        try {
          const res = await useSearchProfilesByName(query)
          setRemoteMentionResults(res || [])
        } catch {
          setRemoteMentionResults([])
        }
      }, 300),
    []
  )

  useEffect(() => {
    if (activeToken?.kind === 'mention' && activeToken.query) {
      searchMentions(activeToken.query)
    } else {
      setRemoteMentionResults([])
    }
  }, [activeToken, searchMentions])

  // Only real accounts can be mentioned: the list merges known users with
  // remote search results, filters accent-insensitively, and never offers
  // the creator their own account.
  const mentionSuggestions = useMemo(() => {
    if (activeToken?.kind !== 'mention') return []

    const selfId = contextUser?.user?.id
    const seen: Record<string, boolean> = {}
    const pool = [...candidateUsers, ...remoteMentionResults].filter((user) => {
      if (!user?.id || user.id === selfId || seen[user.id]) return false
      seen[user.id] = true
      return true
    })

    const query = foldName(activeToken.query)
    const matches = query
      ? pool.filter((user) => foldName(user.name || '').includes(query))
      : pool

    return matches.slice(0, 5)
  }, [activeToken, candidateUsers, contextUser?.user?.id, remoteMentionResults])

  const focusAt = (position: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(position, position)
      setActiveToken(tokenAtCaret(el.value, position))
    })
  }

  // Replaces the token being typed with the picked suggestion.
  const completeToken = (replacement: string) => {
    if (!activeToken) return

    const next = (
      value.slice(0, activeToken.start) + replacement + ' ' + value.slice(activeToken.end)
    ).slice(0, maxLength)

    onChange(next)
    setActiveToken(null)
    focusAt(Math.min(activeToken.start + replacement.length + 1, next.length))
  }

  const insertSymbol = (symbol: '#' | '@') => {
    const el = textareaRef.current
    const caret = el && el.selectionStart !== null ? el.selectionStart : value.length
    const needsSpace = caret > 0 && !/\s/.test(value[caret - 1])
    const insert = `${needsSpace ? ' ' : ''}${symbol}`

    const next = (value.slice(0, caret) + insert + value.slice(caret)).slice(0, maxLength)
    if (next === value) return

    onChange(next)
    focusAt(Math.min(caret + insert.length, next.length))
  }

  const highlightedParts = useMemo(() => value.split(/([#@][^\s#@]*)/g), [value])

  const hasSuggestions =
    (activeToken?.kind === 'hashtag' && tagSuggestions.length > 0) ||
    (activeToken?.kind === 'mention' && mentionSuggestions.length > 0)

  return (
    <div className="relative">
      <div className="rounded-md border border-line bg-surface">
        <div className="relative">
          {/* Overlay renders the highlighted text; the textarea above it has
              transparent text so only the caret shows. Typography must match. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[15px] leading-6 text-ink"
          >
            {highlightedParts.map((part, index) =>
              /^[#@]/.test(part) ? (
                <span key={index} className="rounded-[3px] bg-[#dbe3ff] dark:bg-[#3b3b6b]">
                  {part}
                </span>
              ) : (
                <span key={index}>{part}</span>
              )
            )}
            {'​'}
          </div>

          <textarea
            ref={textareaRef}
            value={value}
            maxLength={maxLength}
            rows={4}
            onChange={(event) => {
              onChange(event.target.value)
              setActiveToken(tokenAtCaret(event.target.value, event.target.selectionStart))
            }}
            onKeyUp={syncActiveToken}
            onClick={syncActiveToken}
            onBlur={() => setActiveToken(null)}
            placeholder={placeholder}
            className="relative block w-full resize-none bg-transparent p-2.5 text-[15px] leading-6 text-transparent outline-none placeholder:text-ink-soft"
            style={{ caretColor: 'var(--tt-text)' }}
          />
        </div>

        <div className="flex items-center justify-between border-t border-line px-2.5 py-2">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                insertSymbol('#')
              }}
              className="flex items-center gap-1 text-[13px] font-semibold text-ink-soft hover:text-ink"
            >
              <BsHash size={16} />
              Hashtags
            </button>
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                insertSymbol('@')
              }}
              className="flex items-center gap-1 text-[13px] font-semibold text-ink-soft hover:text-ink"
            >
              <HiOutlineAtSymbol size={16} />
              Mention
            </button>
          </div>
          <div className="text-[12px] text-ink-soft">
            {value.length}/{maxLength}
          </div>
        </div>
      </div>

      {hasSuggestions ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-elevated shadow-rail">
          {activeToken?.kind === 'hashtag'
            ? tagSuggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    completeToken(`#${tag}`)
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-subtle"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-subtle text-ink-soft">
                    <BsHash size={16} />
                  </span>
                  <span className="text-[14px] font-semibold text-ink">#{tag}</span>
                </button>
              ))
            : mentionSuggestions.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    rememberMention(profile.name, profile.id)
                    completeToken(`@${profile.name.replace(/\s+/g, '')}`)
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-subtle"
                >
                  <img
                    src={useCreateBucketUrl(profile.image)}
                    className="h-8 w-8 rounded-full object-cover"
                    alt={profile.name}
                  />
                  <span className="text-[14px] font-semibold text-ink">@{profile.name}</span>
                </button>
              ))}
        </div>
      ) : null}
    </div>
  )
}

export default CaptionComposer
