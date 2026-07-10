/** Single source of truth for a service ticket's billed total. */
export function ticketTotal(parts: {
  serviceCharge: number;
  costOfSpares: number;
  amcCharge: number;
}): number {
  return parts.serviceCharge + parts.costOfSpares + parts.amcCharge;
}
