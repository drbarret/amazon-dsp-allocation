import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/dispatch",
        destination: "/disponibilidades",
        permanent: true,
      },
      {
        source: "/dispatch/:path*",
        destination: "/disponibilidades/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
