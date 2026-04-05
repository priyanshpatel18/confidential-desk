import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pino-pretty", "lokijs", "encoding"],
  turbopack: { root: path.resolve(process.cwd()) },
};

export default nextConfig;
