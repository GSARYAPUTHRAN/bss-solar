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

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT?.trim() || `mailto:${COMPANY.email}`,
  };
}

/** Is push wired up on this deployment? (Safe to expose to the UI.) */
export function isPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return pushConfig(env) !== null;
}
