export type ToastKind = 'success' | 'error' | 'info'

export interface ToastPayload {
  id: number
  kind: ToastKind
  message: string
}

const TOAST_EVENT = 'tt-toast'
let nextToastId = 1

/**
 * Fire-and-forget toast notification. Rendered by <ToastHost /> (mounted in
 * AllOverlays), so it works from any client component or plain util.
 */
export function showToast(message: string, kind: ToastKind = 'success') {
  if (typeof window === 'undefined') return
  const payload: ToastPayload = { id: nextToastId++, kind, message }
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }))
}

export function subscribeToToasts(listener: (toast: ToastPayload) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => listener((event as CustomEvent<ToastPayload>).detail)
  window.addEventListener(TOAST_EVENT, handler)
  return () => window.removeEventListener(TOAST_EVENT, handler)
}
