import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PwaRegister } from '@/components/pwa-register';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'SproutUp',
    template: '%s | SproutUp',
  },
  description: 'A transparent Philippine SME debt-crowdfunding platform.',
  applicationName: 'SproutUp',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SproutUp',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#287a4b',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-[100dvh] bg-canvas text-foreground antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
