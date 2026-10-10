import { Field, FieldGrid } from "@/components/layout";
import { formatKw } from "@/lib/domain/capacity";
import { customerKsebFees, KSEB_FEES } from "@/lib/domain/kseb";
import { formatCurrency } from "@/lib/format";

const FEE_NOTE =
  `Registration is ${formatCurrency(KSEB_FEES.registrationFeePerKw)} per kW + ` +
  `${Math.round(KSEB_FEES.gstRate * 100)}% GST. If the plant is not commissioned ` +
  `within the feasibility validity, each further ${KSEB_FEES.feasibilityValidityDays}-day ` +
  `period costs BSS ${formatCurrency(KSEB_FEES.feasibilityRenewalFee)}.`;

/**
 * What the customer owes KSEB for this installation, priced from the numeric
 * capacity the database derives from the label. These are KSEB's charges (the
 * customer pays them); they are not part of the BSS contract.
 */
export function KsebFeesEstimate({ kw }: { kw: number | string | null }) {
  const fees = customerKsebFees(kw);
  const registration = fees.registration;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">KSEB charges (paid by the customer)</h3>
      <FieldGrid cols={3}>
        <Field
          label="Feasibility fee"
          value={`${formatCurrency(fees.feasibility)} · valid ${KSEB_FEES.feasibilityValidityDays} days`}
        />
        <Field
          label={registration ? `Registration (${formatKw(registration.kw)})` : "Registration"}
          value={
            registration
              ? `${formatCurrency(registration.base)} + ${formatCurrency(registration.gst)} GST`
              : "Capacity has no number — edit it to price this"
          }
        />
        <Field
          label="Total estimate"
          value={fees.total === null ? null : formatCurrency(fees.total)}
        />
      </FieldGrid>
      <p className="text-xs text-muted-foreground">{FEE_NOTE}</p>
    </div>
  );
}
