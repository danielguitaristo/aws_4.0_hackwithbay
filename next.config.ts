import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A's discovery reads the TTB permit CSVs and the cached runs in data/ with dynamic paths,
  // which Vercel's file tracing can't see: ship them with the API routes explicitly.
  outputFileTracingIncludes: {
    "/api/**": ["./data/ttb/**", "./data/cache/**"],
  },
};

export default nextConfig;
