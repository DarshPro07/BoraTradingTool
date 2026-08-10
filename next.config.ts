import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local Playwright can run beside the owner's dev server without sharing Next's lock/cache.
  distDir: process.env.MARKETPULSE_NEXT_DIST_DIR?.trim() || ".next",
};

export default nextConfig;
