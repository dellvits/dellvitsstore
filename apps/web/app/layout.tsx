import type { Metadata } from 'next';
import './globals.css';
import Provider from '@/components/Provider';
import { Header, Footer } from '@/components/Shell';
export const metadata: Metadata = {
  title: { default: 'Dellvit — Your everyday, delivered', template: '%s | Dellvit' },
  description:
    'Order food, groceries and everyday essentials from local outlets. Dellvit brings your neighbourhood to your doorstep.',
  icons: { icon: '/images/app-logo.webp' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
