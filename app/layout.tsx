import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import AllOverlays from './components/AllOverlays'
import './globals.css'
import UserProvider from './context/user'
import ScrollToTopButton from './components/ScrollToTopButton'
import { usePathname } from 'next/navigation'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'TikTok Clone',
  description: 'TikTok Clone',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <html lang="en">
      <UserProvider>
        <body className={`${pathname == '/' ? 'overflow-hidden' : 'overflow-x-hidden'} dark:bg-dark`}>
          <AllOverlays />
          {children}
          <ScrollToTopButton />
        </body>
      </UserProvider>
    </html>
  )
}
