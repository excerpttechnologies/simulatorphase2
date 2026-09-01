// import type { Metadata } from 'next'
// import { JetBrains_Mono, Rajdhani } from 'next/font/google'
// import { Analytics } from '@vercel/analytics/next'
// import './globals.css'

// const jetbrainsMono = JetBrains_Mono({ 
//   subsets: ["latin"],
//   variable: '--font-mono'
// });

// const rajdhani = Rajdhani({ 
//   subsets: ["latin"],
//   weight: ['300', '400', '500', '600', '700'],
//   variable: '--font-display'
// });

// export const metadata: Metadata = {
//   title: 'PR Coater-Developer Track Simulator',
//   description: 'Semiconductor process training tool for engineering students',
//   generator: 'v0.app',
//   icons: {
//     icon: [
//       {
//         url: '/icon-light-32x32.png',
//         media: '(prefers-color-scheme: light)',
//       },
//       {
//         url: '/icon-dark-32x32.png',
//         media: '(prefers-color-scheme: dark)',
//       },
//       {
//         url: '/icon.svg',
//         type: 'image/svg+xml',
//       },
//     ],
//     apple: '/apple-icon.png',
//   },
// }

// export default function RootLayout({
//   children,
// }: Readonly<{
//   children: React.ReactNode
// }>) {
//   return (
//     <html lang="en" className={`${jetbrainsMono.variable} ${rajdhani.variable}`}>
//       <body className="font-mono antialiased bg-hmi-dark text-hmi-text">
//         {children}
//         {process.env.NODE_ENV === 'production' && <Analytics />}
//       </body>
//     </html>
//   )
// }


import type { Metadata } from 'next'
import { JetBrains_Mono, Rajdhani } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from '@/lib/components/Providers'
import './globals.css'
import './alarm-module.css'

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ["latin"],
  variable: '--font-mono'
});

const rajdhani = Rajdhani({ 
  subsets: ["latin"],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-display'
});

export const metadata: Metadata = {
  title: 'PR Coater-Developer Track Simulator',
  description: 'Semiconductor process training tool for engineering students',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${rajdhani.variable}`}>
      <body suppressHydrationWarning className="font-mono antialiased bg-slate-50 text-hmi-text">
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
