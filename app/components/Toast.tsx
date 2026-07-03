'use client'

import { useEffect, useState } from 'react'
import { AiOutlineCheckCircle, AiOutlineCloseCircle, AiOutlineInfoCircle } from 'react-icons/ai'
import { ToastPayload, subscribeToToasts } from '../utils/toast'

const TOAST_DURATION_MS = 2600

const ICONS = {
  success: AiOutlineCheckCircle,
  error: AiOutlineCloseCircle,
  info: AiOutlineInfoCircle,
} as const

/** Renders toast notifications fired via showToast(). Mounted once in AllOverlays. */
const ToastHost = () => {
  const [toasts, setToasts] = useState<ToastPayload[]>([])

  useEffect(() => {
    return subscribeToToasts((toast) => {
      setToasts((prev) => [...prev.slice(-2), toast])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, TOAST_DURATION_MS)
    })
  }, [])

  if (toasts.length < 1) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+72px)] z-[90] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind]
        return (
          <div
            key={toast.id}
            className="tt-fade-in flex max-w-[90vw] items-center gap-2 rounded-full bg-black/85 px-4 py-2.5 text-sm font-semibold text-white shadow-rail backdrop-blur-sm md:max-w-[420px]"
          >
            <Icon size={18} className={toast.kind === 'error' ? 'text-tiktok' : 'text-tiktok-cyan'} />
            <span className="truncate">{toast.message}</span>
          </div>
        )
      })}
    </div>
  )
}

export default ToastHost
