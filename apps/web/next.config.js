/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['sharp', 'ws', '@resvg/resvg-js', 'satori', '@supabase/supabase-js', '@supabase/postgrest-js', '@supabase/auth-js', '@supabase/realtime-js', '@supabase/storage-js', '@supabase/functions-js'],
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
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

module.exports = nextConfig;
