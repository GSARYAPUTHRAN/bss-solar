/**
 * Links that put a site one tap away for field staff: dial the customer, or
 * open the address in Google Maps (which hands off to the native app on a
 * phone). Return `null` when there is nothing usable to link.
 */

/**
 * A `tel:` URI for a free-text phone number. Keeps a leading `+` and the
 * digits; drops spaces, dashes, brackets and dots that people type.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/** A Google Maps search for an address (cross-platform "Maps URLs" API). */
export function mapsSearchHref(address: string | null | undefined): string | null {
  const query = address?.replace(/\s+/g, " ").trim();
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
