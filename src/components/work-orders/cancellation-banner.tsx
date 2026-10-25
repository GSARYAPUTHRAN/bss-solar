import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CANCELLATION } from "@/lib/domain/cancellation";
import { formatDate } from "@/lib/format";
import type { ProjectCancellation } from "@/lib/types";

/**
 * Says on the work order that its project left the pipeline: "Refunded on 12 Feb
 * 2025 — <remarks>", or "Refunded (date not recorded)" for a bulk-loaded row
 * that never had one. The remarks (what was returned, and how) are the history
 * note the office wrote. The office gets a way to the project, where the status
 * is managed; coordinators just read it.
 */
export function CancellationBanner({
  cancellation,
  cancelledOn,
  remarks,
  manageHref,
}: {
  cancellation: ProjectCancellation;
  cancelledOn: string | null | undefined;
  remarks: string | null | undefined;
  /** The project's page — offered to the office only. */
  manageHref?: string;
}) {
  const label = CANCELLATION[cancellation].label;
  const note = remarks?.trim();

  return (
    <div role="status" className="space-y-1 rounded-md bg-muted px-4 py-3 text-sm">
      <p>
        <strong className="font-semibold">{label}</strong>{" "}
        {cancelledOn ? `on ${formatDate(cancelledOn)}` : "(date not recorded)"}
        {note && <span className="whitespace-pre-line"> — {note}</span>}
      </p>
      {manageHref && (
        <Link
          href={manageHref}
          className="inline-flex min-h-10 items-center gap-1 font-medium text-primary hover:underline md:min-h-0"
        >
          Manage on the project
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
