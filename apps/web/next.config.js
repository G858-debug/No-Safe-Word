const DASHBOARD_URL =
  process.env.DASHBOARD_URL || "http://localhost:3000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.civitai.com",
      },
      {
        protocol: "https",
        hostname: "*.digitaloceanspaces.com",
      },
      {
        protocol: "https",
        hostname: "orchestration.civitai.com",
      },
    ],
  },
  async rewrites() {
    return [
      // Proxy dashboard page routes to the dashboard app
      {
        source: "/dashboard/:path*",
        destination: `${DASHBOARD_URL}/dashboard/:path*`,
      },
      // Proxy dashboard API routes to the dashboard app
      {
        source: "/api/stories/:path*",
        destination: `${DASHBOARD_URL}/api/stories/:path*`,
      },
      {
        source: "/api/images/:path*",
        destination: `${DASHBOARD_URL}/api/images/:path*`,
      },
      {
        source: "/api/characters/:path*",
        destination: `${DASHBOARD_URL}/api/characters/:path*`,
      },
      {
        source: "/api/ai/:path*",
        destination: `${DASHBOARD_URL}/api/ai/:path*`,
      },
      {
        source: "/api/status/:path*",
        destination: `${DASHBOARD_URL}/api/status/:path*`,
      },
      {
        source: "/api/civitai/:path*",
        destination: `${DASHBOARD_URL}/api/civitai/:path*`,
      },
      {
        source: "/api/webhook/story-import",
        destination: `${DASHBOARD_URL}/api/webhook/story-import`,
      },
    ];
  },
};

module.exports = nextConfig;
