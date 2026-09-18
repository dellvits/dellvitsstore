import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    // Vercel's root services configuration routes /api directly to Express.
    if (process.env.VERCEL) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/api/:path*`,
      },
    ];
  },
};
export default config;
