/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
};

module.exports = nextConfig;
