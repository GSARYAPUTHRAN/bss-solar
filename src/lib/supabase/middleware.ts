import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** Reachable signed out: the sign-in flow. */
const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Never need a session, so they skip the auth round-trip entirely:
 *  - /api/cron — called by the scheduler with no cookies; the route checks its
 *    own bearer secret;
 *  - PWA files — browsers fetch the manifest without cookies, and a service
 *    worker script must never be answered with a redirect (its update would
 *    fail on every expired session).
 */
const SESSIONLESS_PREFIXES = ["/api/cron", "/icons"];
const SESSIONLESS_FILES = ["/sw.js", "/manifest.webmanifest"];

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isSessionlessPath(path: string): boolean {
  return (
    SESSIONLESS_FILES.includes(path) ||
    SESSIONLESS_PREFIXES.some((prefix) => underPrefix(path, prefix))
  );
}

export function isPublicPath(path: string): boolean {
  return isSessionlessPath(path) || PUBLIC_PATHS.some((prefix) => underPrefix(path, prefix));
}

export async function updateSession(request: NextRequest) {
  if (isSessionlessPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && !isPublicPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (path === "/signup") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
