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
  const wssOrigin = httpsOrigin.replace(/^https/, "wss");
  const connect = ["'self'", httpsOrigin, wssOrigin].filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
