import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for OpenNext Cloudflare adapter
  output: undefined,
  images: {
    // Cloudflare Workers don't support next/image optimization out of the box
    unoptimized: true,
  },
};

export default nextConfig;
