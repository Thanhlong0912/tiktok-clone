import React, { useState } from 'react'
import { AiOutlineClose } from 'react-icons/ai'
import Login from '@/app/components/auth/Login'
import Register from '@/app/components/auth/Register'
import { useGeneralStore } from '../stores/general'
import ModalShell from './ModalShell'

/**
 * The panel used to be a fixed h-[70%] box with no internal scrolling and a
 * footer pinned with `absolute bottom-0`. Register renders four inputs plus
 * their error slots plus a submit button, which does not fit that height on a
 * phone -- the submit button sat behind the footer and could not be tapped, so
 * signing up on mobile was impossible.
 *
 * Now: capped height, the form scrolls, the footer is a normal flex child, and
 * ModalShell supplies Escape, backdrop close, focus trap and scroll lock.
 */
const AuthOverlay = () => {
  const { isLoginOpen, setIsLoginOpen } = useGeneralStore()
  const [isRegister, setIsRegister] = useState<boolean>(false)

  const close = () => setIsLoginOpen(false)

  return (
    <ModalShell
      isOpen={isLoginOpen}
      label={isRegister ? 'Register' : 'Log in'}
      onClose={close}
      className="max-h-[90dvh] w-full max-w-[470px] rounded-lg"
    >
      <div className="flex justify-end p-4 pb-0">
        <button
          onClick={close}
          aria-label="Close"
          className="rounded-full bg-surface-subtle p-1.5 text-ink"
        >
          <AiOutlineClose size="26" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-0 pb-4 pt-2">
        {isRegister ? <Register /> : <Login />}
      </div>

      <div className="flex shrink-0 items-center justify-center border-t border-line py-5 pb-[calc(env(safe-area-inset-bottom)+20px)] md:pb-5">
        <span className="text-[14px] text-ink-soft">
          {isRegister ? 'Already have an account?' : 'Don’t have an account?'}
        </span>
        <button
          onClick={() => setIsRegister((previous) => !previous)}
          className="pl-1 text-[14px] font-semibold text-tiktok"
        >
          {isRegister ? 'Log in' : 'Register'}
        </button>
      </div>
    </ModalShell>
  )
}

export default AuthOverlay
