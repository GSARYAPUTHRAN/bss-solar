/**
 * Best-effort in-memory fixed-window rate limiter.
 *
 * NOTE: state lives in a single process, so on multi-instance/serverless
 * deployments (e.g. Vercel) this throttles per-instance, not globally. It
 * defends against naive bursts against one instance; for hard guarantees pair
 * it with Supabase Auth's built-in rate limiting / CAPTCHA (see DEPLOY.md) or a
 * shared store (Upstash/Redis). Kept dependency-free and deterministic (`now`
 * is injected) so it is unit-testable.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitResult {
  // Opportunistically evict expired buckets to bound memory growth.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: limit - bucket.count,
    retryAfterSeconds: 0,
  };
}

/** Test-only: clear all buckets. */
export function __resetRateLimiter(): void {
  buckets.clear();
}
