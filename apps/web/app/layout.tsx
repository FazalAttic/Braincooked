import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Brainroad — Attention & Dopamine Analytics Dashboard',
  description: 'Mindfulness dashboard analyzing short-form video consumption across YouTube Shorts and Instagram Reels.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-obsidian text-textMain min-h-screen selection:bg-cream selection:text-obsidian">
        {children}
      </body>
    </html>
  );
}

