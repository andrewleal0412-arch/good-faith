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
