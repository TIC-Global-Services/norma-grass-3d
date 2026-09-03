import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      three: "three/webgpu",
    },
  },
  allowedDevOrigins: ['192.168.1.28'],
};

export default nextConfig;