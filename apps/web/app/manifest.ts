import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dellvit',
    short_name: 'Dellvit',
    description: 'Food, groceries and everyday essentials from local outlets.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fffaf5',
    theme_color: '#d91e45',
    icons: [{ src: '/images/app-logo.webp', sizes: '512x512', type: 'image/webp' }],
  };
}
