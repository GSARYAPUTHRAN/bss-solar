import type { NextConfig } from "next";

/**
 * Content-Security-Policy. Supabase's REST/Auth/Realtime origin is derived from
 * the public env var so the browser client can reach it. `'unsafe-inline'` is
 * required for Next's streaming bootstrap scripts and Tailwind/Radix inline
 * styles; tighten to nonce-based CSP if/when the app moves off inline scripts.
 */
function buildCsp(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let httpsOrigin = "";
  try {
    httpsOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
  } catch {
    httpsOrigin = "";
  }
  // Realtime rides a WebSocket on the same host: https→wss in production,
  // http→ws for the local stack (otherwise the live notification bell is
  // blocked in development).
  const wssOrigin = httpsOrigin.replace(/^http/, "ws");
  const connect = ["'self'", httpsOrigin, wssOrigin].filter(Boolean).join(" ");

  // React's dev server uses eval() for debugging; production never does.
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    // The push service worker (public/sw.js) and the web manifest (app/manifest.ts).
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildCsp() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

/**
 * The service worker must always be revalidated, or a fix to it could take a
 * day to reach phones; it is scoped to the whole app.
 */
const serviceWorkerHeaders = [
  { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
  { key: "Service-Worker-Allowed", value: "/" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    serverActions: {
      // The onboarding bulk CSV import posts the whole file as one form (the
      // default limit is 1 MB).
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: serviceWorkerHeaders },
    ];
  },
};

export default nextConfig;
