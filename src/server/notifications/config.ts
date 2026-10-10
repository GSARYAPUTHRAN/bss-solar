import { COMPANY } from "@/lib/constants";

/**
 * Web Push (VAPID) configuration. Optional by design: without keys the app
 * still records every notification in the in-app inbox; only the browser push
 * is skipped. Generate a pair with `node scripts/generate-vapid-keys.mjs`.
 */
export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` contact the push services can reach. */
  subject: string;
}

const DEFAULT_SUBJECT = `mailto:${COMPANY.email}`;

/**
 * web-push rejects any subject that is not an `https:` or `mailto:` URL, and it
 * does so per send — so a typo here would leave push "configured" while every
 * delivery silently failed. Accept a bare e-mail address (the usual mistake) by
 * adding `mailto:`; fall back to the company contact for anything else.
 */
export function normalizeVapidSubject(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_SUBJECT;
  if (/^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/.test(value)) return `mailto:${value}`;
  try {
    const url = new URL(value);
    if (url.protocol === "mailto:" || url.protocol === "https:") return value;
  } catch {
    // not a URL at all — fall through
  }
  console.warn(
    `[push] VAPID_SUBJECT "${value}" is not an https: or mailto: URL; using ${DEFAULT_SUBJECT}`,
  );
  return DEFAULT_SUBJECT;
}

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: normalizeVapidSubject(env.VAPID_SUBJECT),
  };
}

/** Is push wired up on this deployment? (Safe to expose to the UI.) */
export function isPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return pushConfig(env) !== null;
}
