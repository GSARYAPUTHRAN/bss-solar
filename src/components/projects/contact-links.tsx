import { MapPin, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Site contact links for field staff on phones: tap to call, tap to open the
 * address in Maps. Both fall back to an em dash when there is nothing to link.
 */
export function PhoneLink({
  phone,
  className,
}: {
  phone: string | null | undefined;
  className?: string;
}) {
  if (!phone) return <span className={className}>—</span>;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline md:min-h-0",
        className,
      )}
    >
      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {phone}
    </a>
  );
}

export function MapsLink({
  address,
  className,
}: {
  address: string | null | undefined;
  className?: string;
}) {
  if (!address) return <span className={className}>—</span>;
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-h-10 items-start gap-1.5 text-primary underline-offset-4 hover:underline md:min-h-0",
        className,
      )}
    >
      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {address}
        <span className="sr-only"> (opens in Maps)</span>
      </span>
    </a>
  );
}
