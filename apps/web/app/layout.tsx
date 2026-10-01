import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import Provider from '@/components/Provider';
import { Header, Footer } from '@/components/Shell';
const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
export const metadata: Metadata = {
  title: { default: 'Dellvit — Your everyday, delivered', template: '%s | Dellvit' },
  description:
    'Order food, groceries and everyday essentials from local outlets. Dellvit brings your neighbourhood to your doorstep.',
  icons: { icon: '/images/app-logo.webp', apple: '/images/app-logo.webp' },
};
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#d91e45' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1421' },
  ],
};
// Runs before the page is painted, so a chosen theme never flashes the other one first. With no
// choice saved, the device's own light or dark setting applies through CSS.
const themeScript = `try{var t=localStorage.getItem('dellvit-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Provider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </Provider>
      </body>
    </html>
  );
}
