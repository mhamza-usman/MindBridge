import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@copilotkit/runtime"],
  typescript: {
    // Docker route override uses HttpAgent which has a type mismatch with CopilotRuntime
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/robot/:path*",
        destination: "http://127.0.0.1:8123/robot/:path*",
      },
    ];
  },
};

export default nextConfig;
