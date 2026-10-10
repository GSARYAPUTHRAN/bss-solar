import Link from "next/link";
import { notFound } from "next/navigation";
import { FastForward, Pencil } from "lucide-react";
import { requireWorkOrderRole } from "@/lib/auth";
import { projectsRepository, ticketsRepository } from "@/server/data";
import { paymentsRepository } from "@/server/data/payments.repository";
import { advanceProject, deleteProject } from "../actions";
import { FormError, Page, PageHeader, Section } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { FeasibilityBadge, FinancingBadge } from "@/components/status-badges";
import { ProjectPaymentsSection } from "@/components/payments/project-payments-section";
import { KsebFeasibilitySection } from "@/components/projects/kseb-feasibility-section";
import { MilestoneTimeline } from "@/components/projects/milestone-timeline";
import { ProjectClientDetails } from "@/components/projects/project-client-details";
import { ProjectSettingsForm } from "@/components/projects/project-settings-form";
import { ProjectSummaryCard } from "@/components/projects/project-summary-card";
import { ProjectTicketsSection } from "@/components/projects/project-tickets-section";
import { feasibilityStatus } from "@/lib/domain/kseb";
import { ledgerTotals, paymentSummary, type PaymentSource } from "@/lib/domain/payment";
import { isOfficeRole, isSuperAdminRole } from "@/lib/domain/role";
import { formatDate, todayISO } from "@/lib/format";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireWorkOrderRole();
  const { id } = await params;
  const { error } = await searchParams;
  const isOffice = isOfficeRole(profile.role);
  const isSuperAdmin = isSuperAdminRole(profile.role);

  // RLS returns nothing for a coordinator's view of someone else's project.
  const project = await projectsRepository.byId(id);
  if (!project) notFound();

  const [ledger, tickets] = await Promise.all([
    paymentsRepository.listForWorkOrder(project.work_order_id),
    isOffice ? ticketsRepository.listByProject(project.id) : Promise.resolve([]),
  ]);

  const today = todayISO();
  const wo = project.work_order;
  const milestones = [...project.milestones].sort((a, b) => a.sort_order - b.sort_order);
  const done = milestones.filter((m) => m.status === "completed").length;

  // Read live off the work order and the ledger — nothing is denormalised, so
  // edits elsewhere show here on the next render.
  const totals = ledgerTotals(ledger);
  const paymentSource: PaymentSource = {
    total_cost: wo?.total_cost,
    advance_amount: wo?.advance_amount,
    payments_total: totals.contract,
  };
  const payment = paymentSummary(paymentSource);
  const feasibility = feasibilityStatus({
    feasibilityDate: project.feasibility_date,
    completedAt: project.completed_at,
    isCompleted: project.is_completed,
    today,
  });

  const isOwner = project.coordinator_id === profile.id;
  const canEditWorkOrder = isOffice || isOwner;
  const incentive =
    isOffice || isOwner
      ? {
          label: isOwner ? "Your incentive" : "Coordinator incentive",
          amount: project.coordinator_incentive,
          paidOn: project.incentive_paid_on,
        }
      : undefined;

  return (
    <Page size="wide">
      <PageHeader
        title={wo?.client_name ?? "Project"}
        description={`${wo?.plant_capacity ?? ""} · Started ${formatDate(project.started_at)}`}
        backHref="/projects"
      >
        <FinancingBadge financing={wo?.financing_type} bank={wo?.loan_bank_name} />
        <FeasibilityBadge status={feasibility} />
        {canEditWorkOrder && (
          <Button variant="outline" className="h-10 md:h-8" asChild>
            <Link href={`/work-orders/${project.work_order_id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" /> Edit Details
            </Link>
          </Button>
        )}
      </PageHeader>

      <FormError message={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <ProjectSummaryCard
          className="md:col-span-1"
          project={project}
          payment={payment}
          paymentSource={paymentSource}
          progress={{ done, total: milestones.length }}
          incentive={incentive}
        >
          {isOffice && !project.is_completed && (
            <form action={advanceProject} className="pt-2">
              <input type="hidden" name="project_id" value={project.id} />
              <SubmitButton variant="outline" className="w-full" loadingText="Updating…">
                <FastForward className="mr-2 h-4 w-4" /> Complete Next Milestone
              </SubmitButton>
            </form>
          )}
          {isSuperAdmin && (
            <>
              <Separator />
              <ConfirmSubmit
                action={deleteProject}
                fields={{ project_id: project.id }}
                triggerLabel="Delete project"
                triggerVariant="ghost"
                triggerClassName="w-full text-destructive hover:text-destructive"
                title="Delete this project?"
                description="This permanently removes the project and its milestones. Its work order is returned to pending so it can be approved again; service tickets are kept. This cannot be undone."
                confirmLabel="Delete project"
                loadingText="Deleting…"
              />
            </>
          )}
        </ProjectSummaryCard>

        <Section title="KSEB / ANERT Milestones" className="md:col-span-2">
          <MilestoneTimeline
            projectId={project.id}
            milestones={milestones}
            canEdit={isOffice}
            feasibilityCaptured={Boolean(project.feasibility_date)}
          />
        </Section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <KsebFeasibilitySection
          className={isOffice ? "md:col-span-2" : "md:col-span-3"}
          feasibility={feasibility}
          feasibilityDate={project.feasibility_date}
          capacityKw={wo?.plant_capacity_kw ?? null}
          capacityLabel={wo?.plant_capacity ?? null}
          ksebCollected={totals.ksebFees}
        />
        {isOffice && (
          <ProjectSettingsForm
            className="md:col-span-1"
            projectId={project.id}
            feasibilityDate={project.feasibility_date}
            incentive={project.coordinator_incentive}
            incentivePaidOn={project.incentive_paid_on}
            today={today}
          />
        )}
      </div>

      <ProjectPaymentsSection
        workOrderId={project.work_order_id}
        projectId={project.id}
        totalCost={wo?.total_cost ?? null}
        advanceAmount={wo?.advance_amount ?? null}
        isCompleted={project.is_completed}
        viewer={{ canRecord: isOffice, canEdit: isOffice, canDelete: isSuperAdmin }}
      />

      <ProjectClientDetails workOrder={wo} />

      {isOffice && <ProjectTicketsSection projectId={project.id} tickets={tickets} />}
    </Page>
  );
}
