import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  // Self-contained server bundle for Docker. outputFileTracingRoot points at the
  // monorepo root so workspace deps are traced correctly.
  output: "standalone",
  outputFileTracingRoot: join(__dirname, "../../"),
};

export default nextConfig;
