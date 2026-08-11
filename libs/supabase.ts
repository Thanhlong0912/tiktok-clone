import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
    throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy .env.example to .env and fill them in from Supabase → Project settings → API.'
    )
}

export const SUPABASE_URL = url
export const SUPABASE_ANON_KEY = anonKey
export const BUCKET = String(process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'media')

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
