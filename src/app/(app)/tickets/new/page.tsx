import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createTicket } from "../actions";
import { requireAdmin } from "@/lib/auth";
import { getProjectOptions, getCoordinators } from "@/lib/queries";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
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
    getProjectOptions(),
    getCoordinators(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="New Service Ticket"
        description="Raise a routine 6-month check or an ad-hoc service request."
      >
        <Button variant="outline" asChild>
          <Link href="/tickets">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          <form action={createTicket} className="space-y-5">
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <Label>Project / Site</Label>
              <FormSelect
                name="project_id"
                defaultValue={project_id}
                placeholder="Select a project"
                options={projects.map((p) => ({
                  value: p.id,
                  label: `${p.client_name} — ${p.plant_capacity}`,
                }))}
              />
              {projects.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No projects yet. Approve a work order first.
                </p>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Ticket type</Label>
                <FormSelect
                  name="ticket_type"
                  defaultValue="routine_6m"
                  options={(Object.keys(TICKET_TYPE_LABELS) as TicketType[]).map(
                    (t) => ({ value: t, label: TICKET_TYPE_LABELS[t] }),
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduled_date">Scheduled date</Label>
                <Input id="scheduled_date" name="scheduled_date" type="date" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Assign to</Label>
              <FormSelect
                name="assigned_to"
                placeholder="Unassigned"
                options={coordinators.map((c) => ({
                  value: c.id,
                  label: c.full_name,
                }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nature_of_complaint">
                Nature of complaint / reason
              </Label>
              <Textarea
                id="nature_of_complaint"
                name="nature_of_complaint"
                rows={3}
                placeholder="Describe the issue or routine check scope…"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" asChild>
                <Link href="/tickets">Cancel</Link>
              </Button>
              <Button type="submit">Create Ticket</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
