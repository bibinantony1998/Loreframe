import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/api/:path*",
      },
      {
        source: "/public/:path*",
        destination: "http://localhost:3001/public/:path*",
      },
    ];
  },
};

export default nextConfig;
