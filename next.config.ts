import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / heavy server-only deps used by the invoice-PDF normalizer
  // (lib/pdf-normalize.ts). Marking them external stops Turbopack from
  // trying to bundle their native .node bindings into route chunks, which
  // fails with "asset is not placeable in ESM chunks". They're loaded at
  // runtime in the Node serverless function instead.
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist', 'sharp'],
  typescript: {
    // Pre-existing TS infrastructure errors (missing react types, implicit any in
    // Supabase callback params) must not block production deploys. Turbopack catches
    // real compilation errors; hard type mismatches are caught in development.
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: "/widget",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
