import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Maw3ed',
  description: 'Fewer no-shows. More time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
