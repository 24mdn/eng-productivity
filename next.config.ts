import path from "path";
import type { NextConfig } from "next";

// The browser's login form calls Supabase Auth directly (signInWithPassword), so
// connect-src needs that origin. FASTAPI_URL is NOT needed here — Server Components call it
// server-to-server, never from the browser.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// 'unsafe-inline' on script-src/style-src is a pragmatic tradeoff, not the ideal end state:
// Next.js's hydration bootstrap script and this app's `style={{...}}` inline attributes
// (metric-card.tsx, proxy-caveat-banner.tsx) both need it without a nonce-based CSP, which
// would require adding middleware.ts — deliberately not added yet (see CLAUDE.md). Still
// meaningfully restrictive: blocks arbitrary third-party script/frame/object injection.
//
// 'unsafe-eval' is dev-only: Next's dev-mode webpack HMR/Fast Refresh runtime executes
// module code via eval(), and without this the CSP silently blocks it — every client
// component fails to hydrate (no console error pointing at "hydration", just a blocked-eval
// warning), so things like the login form's onSubmit or the logout button's onClick never
// attach. Production builds don't need eval, so this stays out of the prod policy.
const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const contentSecurityPolicy = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly: Next's root-inference walks up looking for lockfiles
  // and can pick up an unrelated one outside this repo (e.g. a lockfile in the user's home
  // directory), which silently broadens what output file tracing includes.
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
