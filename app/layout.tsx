import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import AllOverlays from './components/AllOverlays'
import './globals.css'
import UserProvider from './context/user'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'TikTok Clone',
  description: 'TikTok Clone',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <UserProvider>
        <body className='overflow-x-hidden'>
          <AllOverlays />
          {children}
        </body>
      </UserProvider>
    </html>
  )
}
