import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { ticketsRepository } from "@/server/data";
import { deleteTicket } from "../actions";
import {
  Page,
  PageHeader,
  Section,
  Field,
  FieldGrid,
  FormError,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TicketStatusBadge } from "@/components/status-badges";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { formatCurrency, formatDate } from "@/lib/format";
import { TICKET_TYPE_LABELS } from "@/lib/constants";

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;

  const ticket = await ticketsRepository.byId(id);
  if (!ticket) notFound();

  const client = ticket.project?.work_order;

  return (
    <Page size="wide">
      <PageHeader
        title={ticket.ticket_no ?? "Service Ticket"}
        description={`${TICKET_TYPE_LABELS[ticket.ticket_type]} · ${client?.client_name ?? "No project linked"}`}
        backHref="/tickets"
      >
        <Button variant="outline" asChild>
          <Link href={`/tickets/${ticket.id}/edit`}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Link>
        </Button>
        <DownloadPdfButton ticket={ticket} />
      </PageHeader>

      <FormError message={error} />

      <div className="space-y-4">
        <Section
          title="Overview"
          actions={<TicketStatusBadge status={ticket.status} />}
        >
          <FieldGrid cols={4}>
            <Field label="Client" value={client?.client_name} />
            <Field label="Phone" value={client?.client_phone} />
            <Field label="Scheduled" value={formatDate(ticket.scheduled_date)} />
            <Field label="Service Date" value={formatDate(ticket.service_date)} />
            <Field label="Address" value={client?.address} />
          </FieldGrid>
        </Section>

        <div className="grid gap-4 md:grid-cols-3">
          <Section title="System" contentClassName="space-y-3">
            <Field label="Capacity" value={ticket.sys_capacity} />
            <Field
              label="Loading Capacity"
              value={ticket.sys_loading_capacity}
            />
            <Field label="Make" value={ticket.sys_make} />
            <Field label="Model" value={ticket.sys_model} />
            <Field label="Serial No." value={ticket.sys_serial_no} />
          </Section>

          <Section title="Battery" contentClassName="space-y-3">
            <Field label="Capacity / AH" value={ticket.bat_capacity_ah} />
            <Field label="Make" value={ticket.bat_make} />
            <Field label="Model" value={ticket.bat_model} />
            <Field label="Quantity" value={ticket.bat_qty} />
            <Field label="Battery Bank" value={ticket.bat_bank_nos} />
          </Section>

          <Section title="SPV" contentClassName="space-y-3">
            <Field
              label="Module Capacity"
              value={ticket.spv_module_capacity}
            />
            <Field label="Make" value={ticket.spv_make} />
            <Field label="VOC" value={ticket.spv_voc} />
            <Field label="Total Nos" value={ticket.spv_total_nos} />
            <Field label="Total Watts" value={ticket.spv_total_watts} />
            <Field label="No. of Strings" value={ticket.spv_no_of_strings} />
          </Section>
        </div>

        <Section title="Post-Service Readings" contentClassName="space-y-5">
            {ticket.spv_string_readings?.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">SPV String Readings</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>String</TableHead>
                      <TableHead>Voltage</TableHead>
                      <TableHead>Ampere</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ticket.spv_string_readings.map((s) => (
                      <TableRow key={s.string}>
                        <TableCell>String {s.string}</TableCell>
                        <TableCell>{s.voltage || "—"}</TableCell>
                        <TableCell>{s.ampere || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {ticket.mppt_readings?.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">MPPT Readings</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>MPPT</TableHead>
                      <TableHead>In Volt</TableHead>
                      <TableHead>Out Volt</TableHead>
                      <TableHead>In Ampere</TableHead>
                      <TableHead>Out Ampere</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ticket.mppt_readings.map((m) => (
                      <TableRow key={m.mppt}>
                        <TableCell>MPPT {m.mppt}</TableCell>
                        <TableCell>{m.in_volt || "—"}</TableCell>
                        <TableCell>{m.out_volt || "—"}</TableCell>
                        <TableCell>{m.in_ampere || "—"}</TableCell>
                        <TableCell>{m.out_ampere || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <FieldGrid cols={3}>
              <Field label="Battery Voltage" value={ticket.battery_voltage} />
              <Field label="Charging Current" value={ticket.charging_current} />
              <Field
                label="Battery Water Level"
                value={ticket.battery_water_level}
              />
            </FieldGrid>
        </Section>

        <Section title="Resolution" contentClassName="space-y-4">
            <Field
              label="Nature of Complaint"
              value={ticket.nature_of_complaint}
            />
            <Field label="Defects Found" value={ticket.defects_found} />
            <Field label="Action Taken" value={ticket.action_taken} />
        </Section>

        <Section title="Financials">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-4">
              <Field
                label="Service Charge"
                value={formatCurrency(ticket.service_charge)}
              />
              <Field
                label="Cost of Spares"
                value={formatCurrency(ticket.cost_of_spares)}
              />
              <Field label="AMC Charge" value={formatCurrency(ticket.amc_charge)} />
              <div className="space-y-0.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Total
                </p>
                <p className="text-lg font-bold text-primary">
                  {formatCurrency(ticket.total)}
                </p>
              </div>
            </div>
        </Section>

        <div className="flex justify-end">
          <ConfirmSubmit
            action={deleteTicket}
            fields={{ id: ticket.id }}
            triggerLabel="Delete Ticket"
            triggerVariant="ghost"
            triggerClassName="text-destructive hover:text-destructive"
            title="Delete this service ticket?"
            description="This permanently removes the ticket and its service sheet. This cannot be undone."
            confirmLabel="Delete ticket"
            loadingText="Deleting…"
          />
        </div>
      </div>
    </Page>
  );
}
