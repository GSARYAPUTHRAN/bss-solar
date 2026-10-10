import { createHash, timingSafeEqual } from "node:crypto";

export type CronGate =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Gate for scheduled-job endpoints. Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`; anything else is refused.
 *
 * Fails closed: with no secret configured the endpoint is unusable rather than
 * open. Both sides are hashed before the constant-time compare so neither the
 * secret's content nor its length leaks through response timing.
 */
export function checkCronRequest(
  authorization: string | null,
  secret: string | undefined = process.env.CRON_SECRET,
): CronGate {
  if (!secret || secret.trim().length === 0) {
    return { ok: false, status: 503, error: "Scheduled jobs are not configured." };
  }
  const authorized =
    authorization !== null && timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
  return authorized ? { ok: true } : { ok: false, status: 401, error: "Unauthorized" };
}
