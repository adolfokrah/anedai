import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Aned',
  description:
    'Connect a repo or build from scratch. An agent edits real React in a cloud sandbox with live preview, then opens a PR.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang='en' className='dark'>
      <body className='h-full bg-background text-foreground antialiased'>
        {children}
      </body>
    </html>
  );
}
