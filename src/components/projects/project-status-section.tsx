import { Ban } from "lucide-react";
import { Field, FieldGrid, Section } from "@/components/layout";
import { CancellationBadge } from "@/components/status-badges";
import { formatDate } from "@/lib/format";
import type { ProjectDetail } from "@/server/data/projects.repository";
import { CancellationDialog, ReinstateDialog } from "./cancellation-dialog";

/** "12 Feb 2025", or the plain admission that nobody recorded it. */
function whenLabel(cancelledOn: string | null) {
  return cancelledOn ? (
    formatDate(cancelledOn)
  ) : (
    <span className="font-normal text-muted-foreground">date not recorded</span>
  );
}

/**
 * What the people who share a sale see on a cancelled or refunded project: a
 * read-only banner with the date and the office's remarks. Nothing on a live
 * project (and nothing to act on — only the office changes the status).
 */
export function ClosedProjectBanner({ project }: { project: ProjectDetail }) {
  const { cancellation, cancelled_on: cancelledOn, cancellation_remarks: remarks } = project;
  if (!cancellation) return null;
  return (
    <div role="status" className="space-y-1 rounded-md border bg-muted/60 px-4 py-3 text-sm">
      <p className="font-medium">
        This project was {cancellation}
        {cancelledOn ? ` on ${formatDate(cancelledOn)}` : " (date not recorded)"}.
      </p>
      {remarks && <p className="whitespace-pre-wrap text-muted-foreground">{remarks}</p>}
    </div>
  );
}

/**
 * Where the project stands in its life, for the office: live, or cancelled /
 * refunded. Mark it cancelled or refunded; once it is, who recorded that, when,
 * the remarks, and the way back (edit, reinstate). Cancelling leaves the
 * ledger, milestones and incentives as they were; the dialogs say so.
 *
 * "Recorded by" is whoever entered it in the app (for an imported project, the
 * admin who ran the import), so it is never worded as "cancelled by".
 */
export function ProjectStatusSection({
  project,
  today,
  money,
  unpaid,
  clockImpact,
  className,
}: {
  project: ProjectDetail;
  /** IST date from the server. */
  today: string;
  /** Collected so far (advance + instalments) and what was still due. */
  money: { received: number; balanceDue: number };
  /** Incentives set and not yet paid (the office's view of the whole sale). */
  unpaid: { count: number; total: number };
  /** What reopening the feasibility clock on its old date would cost (see reinstateClockImpact). */
  clockImpact: { feasibilityDate: string; costNow: number; costReopened: number } | null;
  className?: string;
}) {
  const { cancellation, cancelled_on: cancelledOn, cancellation_remarks: remarks } = project;
  const orderDate = project.work_order?.order_date ?? "";
  const solar = project.work_order?.plan_type !== "custom";

  const dialogContext = {
    projectId: project.id,
    today,
    orderDate,
    money,
    clock: {
      feasibilityDate: project.feasibility_date,
      completedAt: project.completed_at,
      isCompleted: project.is_completed,
    },
    unpaid,
  };

  return (
    <Section title="Project status" icon={Ban} className={className} contentClassName="space-y-4">
      {cancellation ? (
        <>
          <FieldGrid cols={2}>
            <Field label="Status" value={<CancellationBadge cancellation={cancellation} />} />
            <Field label="Date" value={whenLabel(cancelledOn)} />
            {project.cancelled_by_name && (
              <Field label="Recorded by" value={project.cancelled_by_name} />
            )}
            <Field
              label="Remarks"
              className="sm:col-span-2"
              value={
                remarks ? (
                  <span className="whitespace-pre-wrap">{remarks}</span>
                ) : (
                  <span className="font-normal text-muted-foreground">No remarks</span>
                )
              }
            />
          </FieldGrid>
          <div className="flex flex-wrap gap-2">
            <CancellationDialog
              {...dialogContext}
              mode="edit"
              kind={cancellation}
              triggerLabel="Edit"
              cancelledOn={cancelledOn}
              remarks={remarks}
            />
            <ReinstateDialog
              projectId={project.id}
              today={today}
              orderDate={orderDate}
              remarks={remarks}
              canSetFeasibility={solar}
              clockImpact={clockImpact}
            />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            This project is live. If the customer backs out, mark it cancelled or refunded —
            nothing is deleted, and it can be reinstated.
          </p>
          <div className="flex flex-wrap gap-2">
            <CancellationDialog
              {...dialogContext}
              mode="cancel"
              kind="cancelled"
              triggerLabel="Mark cancelled"
              cancelledOn={null}
              remarks={null}
            />
            <CancellationDialog
              {...dialogContext}
              mode="cancel"
              kind="refunded"
              triggerLabel="Mark refunded"
              cancelledOn={null}
              remarks={null}
            />
          </div>
          {remarks && (
            <Field
              label="Notes from the earlier cancellation"
              value={<span className="whitespace-pre-wrap">{remarks}</span>}
            />
          )}
        </>
      )}
    </Section>
  );
}
