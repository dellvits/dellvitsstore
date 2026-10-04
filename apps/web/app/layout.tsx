import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import Provider from '@/components/Provider';
import { Header, Footer } from '@/components/Shell';
import PixelPageViews from '@/components/PixelPageViews';
import MaintenanceGate from '@/components/Maintenance';
import { headSettings, headMetadata, AnalyticsTags } from '@/lib/siteHead';
const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: 'Dellvit — Your everyday, delivered', template: '%s | Dellvit' },
    description:
      'Order food, groceries and everyday essentials from local outlets. Dellvit brings your neighbourhood to your doorstep.',
    icons: { icon: '/images/app-logo.webp', apple: '/images/app-logo.webp' },
    // Search Console and Bing verification tags from Store settings.
    ...headMetadata(await headSettings()),
  };
}
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#d91e45' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1421' },
  ],
};
// Runs before the page is painted, so a chosen theme never flashes the other one first. With no
// choice saved the site is light; the device's own setting applies only when "Device default"
// was chosen.
const themeScript = `var t='light';try{var s=localStorage.getItem('dellvit-theme');if(s==='dark'||s==='system')t=s}catch(e){}if(t!=='system')document.documentElement.dataset.theme=t`;
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const head = await headSettings();
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <AnalyticsTags s={head} />
      </head>
      <body>
        {head.facebook_pixel_id && <PixelPageViews />}
        <Provider>
          <MaintenanceGate initial={head.maintenance || null}>
            <a href="#main" className="skip-link">
              Skip to content
            </a>
            <Header />
            <main id="main">{children}</main>
            <Footer />
          </MaintenanceGate>
        </Provider>
      </body>
    </html>
  );
}
