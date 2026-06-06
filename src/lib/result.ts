/**
 * A lightweight discriminated union for operations that can fail without
 * throwing. Used by mutations (e.g. server actions invoked from the client)
 * that need to surface a message instead of a redirect.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}
