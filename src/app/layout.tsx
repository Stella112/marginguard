import type { Metadata } from 'next'
import { Inter, Space_Mono } from 'next/font/google'
import './globals.css'
import './tailwind.css'

// Clean neutral grotesque for everything (matches the Uniswap reference); a mono
// only for hex addresses / hashes.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono-ui',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MarginGuard · Private Dark Pool & Perps on STRK20',
  description: 'A private spot dark pool and perpetuals venue on Starknet, built on STRK20 shielded notes, with agent-verified risk management.',
  metadataBase: new URL('https://getmarginguard.xyz'),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'MarginGuard · Private markets on Starknet',
    description: 'A professional private trading terminal for shielded spot and perp markets.',
    url: 'https://getmarginguard.xyz',
    siteName: 'MarginGuard',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  )
}
