import type { NextConfig } from "next";
import { join } from "node:path";

// On Vercel, let the platform own the build output + tracing (VERCEL=1 at build).
// Everywhere else (Docker) emit a self-contained standalone server, tracing from
// the monorepo root so workspace deps are included.
const nextConfig: NextConfig = process.env.VERCEL
  ? {}
  : {
      output: "standalone",
      outputFileTracingRoot: join(__dirname, "../../"),
    };

export default nextConfig;
