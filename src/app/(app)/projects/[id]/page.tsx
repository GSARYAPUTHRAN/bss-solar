import Link from "next/link";
import { notFound } from "next/navigation";
import { FastForward, PackageCheck, Pencil } from "lucide-react";
import { requireWorkOrderRole } from "@/lib/auth";
import { projectsRepository, ticketsRepository } from "@/server/data";
import { paymentsRepository } from "@/server/data/payments.repository";
import { advanceProject, deleteProject } from "../actions";
import { FormError, Page, PageHeader, Section } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import {
  CancellationBadge,
  FeasibilityBadge,
  FinancingBadge,
  PlanBadge,
} from "@/components/status-badges";
import { ProjectPaymentsSection } from "@/components/payments/project-payments-section";
import { CoordinatorIncentivesSection } from "@/components/projects/coordinator-incentives-section";
import { KsebFeasibilitySection } from "@/components/projects/kseb-feasibility-section";
import { MilestoneTimeline } from "@/components/projects/milestone-timeline";
import { ProjectClientDetails } from "@/components/projects/project-client-details";
import { ProjectSettingsForm } from "@/components/projects/project-settings-form";
import {
  ClosedProjectBanner,
  ProjectStatusSection,
} from "@/components/projects/project-status-section";
import {
  ProjectSummaryCard,
  type SummaryIncentive,
} from "@/components/projects/project-summary-card";
import { ProjectTicketsSection } from "@/components/projects/project-tickets-section";
import { isSaleCoordinator } from "@/lib/domain/coordinators";
import { feasibilityStatus } from "@/lib/domain/kseb";
import { ledgerTotals, paymentSummary, type PaymentSource } from "@/lib/domain/payment";
import {
  incentiveTotals,
  reinstateClockImpact,
  unpaidIncentives,
} from "@/lib/domain/project-settings";
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

  // RLS returns nothing to a coordinator who is not on the sale.
  const project = await projectsRepository.byId(id);
  if (!project) notFound();

  // Everyone on the sale shares it: the office, or one of its coordinators.
  const isMember = isSaleCoordinator(project, profile.id);
  const canSeeTickets = isOffice || isMember;

  const [ledger, tickets] = await Promise.all([
    paymentsRepository.listForWorkOrder(project.work_order_id),
    canSeeTickets ? ticketsRepository.listByProject(project.id) : Promise.resolve([]),
  ]);

  const today = todayISO();
  const wo = project.work_order;
  const plan = wo?.plan_type ?? "solar";
  const custom = plan === "custom";
  const cancelled = project.cancellation !== null;
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
    cancelledOn: project.cancelled_on,
    isCancelled: cancelled,
    today,
  });

  const canEditWorkOrder = isOffice || isMember;

  // The incentive the viewer may see: the whole sale's to the office, their own
  // to a coordinator (the repository only loads what RLS allows anyway).
  const sale = incentiveTotals(project.coordinators);
  const own = project.coordinators.find((c) => c.id === profile.id)?.incentive;
  const incentive: SummaryIncentive | undefined = isOffice
    ? {
        view: "sale",
        total: sale.total,
        count: sale.count,
        unpaidCount: sale.unpaidCount,
      }
    : isMember
      ? { view: "own", amount: own?.amount ?? null, paidOn: own?.paid_on ?? null }
      : undefined;

  const clockImpact =
    cancelled && !custom
      ? reinstateClockImpact({
          feasibilityDate: project.feasibility_date,
          completedAt: project.completed_at,
          isCompleted: project.is_completed,
          cancelledOn: project.cancelled_on,
          today,
        })
      : null;

  return (
    <Page size="wide">
      <PageHeader
        title={wo?.client_name ?? "Project"}
        description={`${wo?.plant_capacity ?? ""} · Started ${formatDate(project.started_at)}`}
        backHref="/projects"
      >
        <FinancingBadge financing={wo?.financing_type} bank={wo?.loan_bank_name} />
        <PlanBadge plan={plan} />
        <CancellationBadge cancellation={project.cancellation} />
        {/* A custom plan has no feasibility clock to be "not set". */}
        {!custom && <FeasibilityBadge status={feasibility} />}
        {canEditWorkOrder && (
          <Button variant="outline" className="h-10 md:h-8" asChild>
            <Link href={`/work-orders/${project.work_order_id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" /> Edit Details
            </Link>
          </Button>
        )}
      </PageHeader>

      <FormError message={error} />

      {!isOffice && <ClosedProjectBanner project={project} />}

      <div className="grid gap-4 md:grid-cols-3">
        <ProjectSummaryCard
          className="md:col-span-1"
          project={project}
          payment={payment}
          paymentSource={paymentSource}
          progress={{ done, total: milestones.length }}
          incentive={incentive}
          changeCoordinatorsHref={
            isOffice ? `/work-orders/${project.work_order_id}#coordinators` : undefined
          }
        >
          {isOffice && !project.is_completed && !cancelled && (
            <form action={advanceProject} className="pt-2">
              <input type="hidden" name="project_id" value={project.id} />
              <SubmitButton variant="outline" className="w-full" loadingText="Updating…">
                {custom ? (
                  <>
                    <PackageCheck className="mr-2 h-4 w-4" /> Mark handed over
                  </>
                ) : (
                  <>
                    <FastForward className="mr-2 h-4 w-4" /> Complete Next Milestone
                  </>
                )}
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
                description="This permanently removes the project and its milestones. Its work order is returned to pending so it can be approved again; service tickets are kept. Coordinator incentives stay with the sale and reappear if it is approved again. This cannot be undone."
                confirmLabel="Delete project"
                loadingText="Deleting…"
              />
            </>
          )}
        </ProjectSummaryCard>

        <Section
          title={custom ? "Handover" : "KSEB / ANERT Milestones"}
          className="md:col-span-2"
          contentClassName="space-y-4"
        >
          {isOffice && cancelled && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Reinstate the project to change its milestones.
            </p>
          )}
          <MilestoneTimeline
            projectId={project.id}
            milestones={milestones}
            plan={plan}
            canEdit={isOffice && !cancelled}
            feasibilityCaptured={Boolean(project.feasibility_date)}
          />
        </Section>
      </div>

      {isOffice && (
        <div className="grid gap-4 md:grid-cols-2">
          <ProjectStatusSection
            project={project}
            today={today}
            money={{ received: payment.received, balanceDue: payment.balanceDue }}
            unpaid={unpaidIncentives(project.coordinators)}
            clockImpact={clockImpact}
          />
          <CoordinatorIncentivesSection
            projectId={project.id}
            coordinators={project.coordinators}
            today={today}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <KsebFeasibilitySection
          className={isOffice && !custom ? "md:col-span-2" : "md:col-span-3"}
          feasibility={feasibility}
          feasibilityDate={project.feasibility_date}
          capacityKw={wo?.plant_capacity_kw ?? null}
          capacityLabel={wo?.plant_capacity ?? null}
          ksebCollected={totals.ksebFees}
          plan={plan}
          cancellation={project.cancellation}
          isCompleted={project.is_completed}
        />
        {isOffice && !custom && (
          <ProjectSettingsForm
            className="md:col-span-1"
            projectId={project.id}
            feasibilityDate={project.feasibility_date}
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
        cancellation={project.cancellation}
        viewer={{ canRecord: isOffice, canEdit: isOffice, canDelete: isSuperAdmin }}
      />

      <ProjectClientDetails workOrder={wo} />

      {canSeeTickets && (
        <ProjectTicketsSection
          projectId={project.id}
          tickets={tickets}
          readOnly={!isOffice}
        />
      )}
    </Page>
  );
}
