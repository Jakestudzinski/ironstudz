import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // The inventory stock code uses node-postgres directly (row locks for first-in-first-out).
  serverExternalPackages: ["pg"],
  // Pin Turbopack's root to this project so it ignores lockfiles in parent dirs.
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
