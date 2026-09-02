import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      three: "three/webgpu",
    },
  },
};

export default nextConfig;