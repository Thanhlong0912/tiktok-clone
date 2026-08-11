import { ShowErrorObject } from '@/app/types';
import React, { useState } from 'react'
import TextInput from '../TextInput';
import { BiLoaderCircle } from 'react-icons/bi';
import { useUser } from '@/app/context/user';
import { useGeneralStore } from '@/app/stores/general';

const Login = () => {
    let { setIsLoginOpen } = useGeneralStore();
    const contextUser = useUser()

  const [loading, setLoading] = useState<boolean>(false);
  const [email, setEmail] = useState<string | ''>('');
  const [password, setPassword] = useState<string | ''>('');
  const [error, setError] = useState<ShowErrorObject | null>(null)

  const showError = (type: string) => {
    if (error && Object.entries(error).length > 0 && error?.type == type) {
        return error.message
    }
    return ''
  }

  const validate = () => {
    setError(null)
    let isError = false

    const reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/

    if (!email) {
        setError({ type: 'email', message: 'An Email is required'})
        isError = true
    } else if (!reg.test(email)) {
        setError({ type: 'email', message: 'Log in with your email address, not your username'})
        isError = true
    } else if (!password) {
        setError({ type: 'password', message: 'A Password is required'})
        isError = true
    }
    return isError
  }

  const login = async () => {
    let isError = validate()
    if (isError) return
    if (!contextUser) return

    try {
        setLoading(true)
        await contextUser.login(email, password)
        setLoading(false)
        setIsLoginOpen(false)
    } catch (error) {
        console.log(error)
        setLoading(false)
        // Supabase answers both an unknown email and a wrong password with the
        // same generic message, so say that rather than leaking the raw error.
        const message = (error as { message?: string })?.message
        setError({
            type: 'form',
            message: message === 'Invalid login credentials'
                ? 'Incorrect email or password'
                : message || 'Something went wrong, please try again'
        })
    }
  }

  return (
    <>
       <div>
        <h1 className="text-center text-[28px] mb-4 font-bold text-ink">Log in</h1>

        <div className="px-6 pb-2">
            <TextInput
                string={email}
                placeholder="Email address"
                onUpdate={setEmail}
                inputType="email"
                error={showError('email')}
            />
        </div>

        <div className="px-6 pb-2">
            <TextInput
                string={password}
                placeholder="Password"
                onUpdate={setPassword}
                inputType="password"
                error={showError('password')}
            />
        </div>

        {showError('form') ? (
            <div className="px-6 pt-2 text-[14px] font-semibold text-[#F02C56]">
                {showError('form')}
            </div>
        ) : null}

        <div className="px-6 pb-2 mt-6">
            <button
                disabled={loading}
                onClick={() => login()}
                className={`
                    flex items-center justify-center w-full text-[17px] font-semibold text-white py-3 rounded-sm
                    ${(!email || !password) ? 'bg-surface-subtle text-ink-soft' : 'bg-[#F02C56]'}
                `}
            >
                {loading ? <BiLoaderCircle className="animate-spin" color="#ffffff" size={25} /> : 'Log in'}
            </button>
        </div>
     </div>
    </>
  )
}

export default Login
