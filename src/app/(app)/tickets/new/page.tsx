import Link from "next/link";
import { createTicket } from "../actions";
import { requireAdmin } from "@/lib/auth";
import { profilesRepository, projectsRepository } from "@/server/data";
import {
  Page,
  PageHeader,
  Section,
  FormField,
  FormGrid,
  FormActions,
  FormError,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/form-select";
import { TICKET_TYPE_LABELS } from "@/lib/constants";
import type { TicketType } from "@/lib/types";

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; project_id?: string }>;
}) {
  await requireAdmin();
  const { error, project_id } = await searchParams;
  const [projects, coordinators] = await Promise.all([
    projectsRepository.options(),
    profilesRepository.coordinators(),
  ]);

  return (
    <Page size="tight">
      <PageHeader
        title="New Service Ticket"
        description="Raise a routine 6-month check or an ad-hoc service request."
        backHref="/tickets"
      />

      <Section>
        <form action={createTicket} className="space-y-5">
          <FormError message={error} />

          <FormField
            label="Project / Site"
            hint={
              projects.length === 0
                ? "No projects yet. Approve a work order first."
                : undefined
            }
          >
            <FormSelect
              name="project_id"
              defaultValue={project_id}
              placeholder="Select a project"
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.client_name} — ${p.plant_capacity}`,
              }))}
            />
          </FormField>

          <FormGrid>
            <FormField label="Ticket type">
              <FormSelect
                name="ticket_type"
                defaultValue="routine_6m"
                options={(Object.keys(TICKET_TYPE_LABELS) as TicketType[]).map(
                  (t) => ({ value: t, label: TICKET_TYPE_LABELS[t] }),
                )}
              />
            </FormField>
            <FormField label="Scheduled date" htmlFor="scheduled_date">
              <Input id="scheduled_date" name="scheduled_date" type="date" />
            </FormField>
          </FormGrid>

          <FormField label="Assign to">
            <FormSelect
              name="assigned_to"
              placeholder="Unassigned"
              options={coordinators.map((c) => ({
                value: c.id,
                label: c.full_name,
              }))}
            />
          </FormField>

          <FormField
            label="Nature of complaint / reason"
            htmlFor="nature_of_complaint"
          >
            <Textarea
              id="nature_of_complaint"
              name="nature_of_complaint"
              rows={3}
              placeholder="Describe the issue or routine check scope…"
            />
          </FormField>

          <FormActions>
            <Button variant="outline" asChild>
              <Link href="/tickets">Cancel</Link>
            </Button>
            <SubmitButton loadingText="Creating…">Create Ticket</SubmitButton>
          </FormActions>
        </form>
      </Section>
    </Page>
  );
}
