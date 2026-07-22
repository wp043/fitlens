import type { NextConfig } from "next";
import { browserSecurityHeaders } from "./lib/security-headers.ts";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: browserSecurityHeaders(process.env.NODE_ENV !== "production"),
      },
    ];
  },
};

export default nextConfig;
