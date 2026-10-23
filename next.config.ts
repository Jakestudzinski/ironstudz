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
  async headers() {
    return [
      {
        // Basic protections for every page: no framing (clickjacking), no MIME sniffing, no referrer leaks.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Inventory pages and data are private: never cache them in shared caches, never index them.
        source: "/(admin|api)/inventory/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
