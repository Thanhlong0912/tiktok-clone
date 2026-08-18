import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import AllOverlays from './components/AllOverlays'
import './globals.css'
import UserProvider from './context/user'
import ScrollToTopButton from './components/ScrollToTopButton'
import ThemeInitializer from './components/ThemeInitializer'

const inter = Inter({ subsets: ['latin'] })

// Without this, Next resolves social image urls against http://localhost:3000
// and warns on every build. Vercel sets NEXT_PUBLIC_SITE_URL per deployment.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'TikTok Clone',
    template: '%s · TikTok Clone',
  },
  description: 'Short-form video feed: watch, post, follow and comment.',
  openGraph: {
    title: 'TikTok Clone',
    description: 'Short-form video feed: watch, post, follow and comment.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          In <head>, not <body>: this has to run before the first paint or the
          light palette flashes on every load for dark-mode viewers.
        */}
        <ThemeInitializer />
      </head>
      {/*
        inter.className was previously never applied, so next/font downloaded
        the family and globals.css fell back to system fonts anyway.
      */}
      <body className={`${inter.className} overflow-x-hidden bg-surface`}>
        <UserProvider>
          <AllOverlays />
          {children}
          <ScrollToTopButton />
        </UserProvider>
      </body>
    </html>
  )
}
