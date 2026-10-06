import type { NextConfig } from "next";

// Response headers for every route. Only frame-ancestors is set in the CSP: a script or style policy would need a
// nonce on every page (Next's inline bootstrap, AG Grid's injected styles), and this one only stops the app being
// framed by another site. The tenants' pages and their files send no referrer at all, so the token in their address
// never leaves the site (the page's metadata says the same).
const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  // No dev-tools badge in the corner: the demo is filmed from next dev, and the statement is screenshotted from it.
  devIndicators: false,
  // No x-powered-by header (Next's own error pages sent it while the app's routes didn't).
  poweredByHeader: false,
  // No gzip in Node: the hosted demo sits behind Render's Cloudflare edge, which compresses every response itself
  // (Brotli or gzip, whichever the browser takes; checked on 2026-10-05), so compressing here only spent the small
  // server's CPU, on every page and on every script a new browser downloads (docs/PERFORMANCE.md). A host without such
  // an edge would want this back on.
  compress: false,
  // The keep-alive HTTP pool (src/lib/http.ts) loads undici from node_modules as Node does, not bundled.
  serverExternalPackages: ["undici"],
  experimental: {
    // Next buffers a request body before the proxy runs, so the route can read it too, and keeps at most this much of
    // it in memory (the rest is cut off, not refused). No route takes more than the upload budget plus its form
    // framing (REQUEST_LIMIT in src/lib/uploads.ts, 4.5 MB): the proxy answers a bigger declared body with a 413, and
    // a body cut off here fails the route's own checks.
    proxyClientMaxBodySize: "5mb",
  },
  async headers() {
    return [
      { source: "/:path*", headers: security },
      // Later entries win for the same key.
      { source: "/t/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/api/t/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
