import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use the Node mongoose build in server bundles (avoid browser.umd.js).
  serverExternalPackages: ["mongoose"],
};

export default nextConfig;
