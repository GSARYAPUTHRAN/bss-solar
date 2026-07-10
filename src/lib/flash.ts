/**
 * Build a redirect target that surfaces a one-off toast on the destination via
 * <FlashToast />. Use for success feedback after a server action; keep `?error=`
 * for inline form-level failures.
 */
export function withFlash(
  path: string,
  message: string,
  type: "success" | "error" = "success",
): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}flash=${encodeURIComponent(message)}&flashType=${type}`;
}
