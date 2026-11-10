import type { NextConfig } from "next";

// Optional self-host/test proxy. Production Vercel leaves this unset and runs
// only the private on-device converter. Docker Compose uses Caddy instead.
const nativeEndpoint = process.env.NATIVE_INTERNAL_URL;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@any-convert/contracts", "@any-convert/media-core"],
  async rewrites() {
    return nativeEndpoint
      ? [{ source: "/api/native/:path*", destination: nativeEndpoint + "/api/native/:path*" }]
      : [];
  },
};

export default nextConfig;
