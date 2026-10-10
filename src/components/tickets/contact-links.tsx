import { MapPin, Phone } from "lucide-react";
import { mapsSearchHref, telHref } from "@/lib/domain/contact-links";
import { cn } from "@/lib/utils";

// Field staff tap these on a phone, so each link is a full-height (≥40px) row
// target rather than a bare inline anchor.
const LINK_CLASS =
  "inline-flex min-h-10 items-center gap-2 rounded-md py-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A phone number that dials on tap; plain text when it is not dialable. */
export function PhoneLink({
  phone,
  className,
}: {
  phone: string | null | undefined;
  className?: string;
}) {
  if (!phone) return <span className="text-sm text-muted-foreground">—</span>;
  const href = telHref(phone);
  if (!href) return <span className={cn("text-sm", className)}>{phone}</span>;
  return (
    <a href={href} className={cn(LINK_CLASS, className)} aria-label={`Call ${phone}`}>
      <Phone className="h-4 w-4 shrink-0" aria-hidden />
      <span className="tabular-nums">{phone}</span>
    </a>
  );
}

/** An address that opens in Google Maps (the Maps app on a phone). */
export function AddressLink({
  address,
  className,
}: {
  address: string | null | undefined;
  className?: string;
}) {
  const href = mapsSearchHref(address);
  if (!address || !href) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(LINK_CLASS, "items-start text-left", className)}
      aria-label={`Open ${address} in Google Maps`}
    >
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="whitespace-pre-line break-words">{address}</span>
    </a>
  );
}
