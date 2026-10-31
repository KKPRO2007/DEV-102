/** @type {import('next').NextConfig} */
const nextConfig = {
  // No floating "N" badge in development; the site's own dev toolbar opens with Ctrl+Shift+D.
  devIndicators: false,
  // `npm run start:lan` serves the site on this laptop's Wi-Fi address for a friend's laptop.
  ...(process.env.LAN_HOST ? { allowedDevOrigins: [process.env.LAN_HOST] } : {}),
  // The organization and proctor consoles used to live at /admin and /mentor.
  async redirects() {
    return [
      { source: '/admin', destination: '/organization', permanent: true },
      { source: '/admin/:path*', destination: '/organization/:path*', permanent: true },
      { source: '/mentor', destination: '/proctor', permanent: true },
      { source: '/mentor/:path*', destination: '/proctor/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
