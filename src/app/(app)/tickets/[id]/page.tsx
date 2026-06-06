import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteTicket } from "../actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { ServiceTicket } from "@/lib/types";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireProfile();
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const isAdmin = profile.role === "admin";

  const { data } = await supabase
    .from("service_tickets")
    .select(
      `*,
       project:projects!service_tickets_project_id_fkey(
         id, work_order_id,
         work_order:work_orders!projects_work_order_id_fkey(client_name, address, client_phone)
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const ticket = data as ServiceTicket;
  const client = ticket.project?.work_order;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={ticket.ticket_no ?? "Service Ticket"}
        description={`${TICKET_TYPE_LABELS[ticket.ticket_type]} · ${client?.client_name ?? "No project linked"}`}
      >
        <Button variant="outline" asChild>
          <Link href="/tickets">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
        {isAdmin && (
          <Button variant="outline" asChild>
            <Link href={`/tickets/${ticket.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Link>
          </Button>
        )}
        <DownloadPdfButton ticket={ticket} />
      </PageHeader>

      {error && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Overview</CardTitle>
            <TicketStatusBadge status={ticket.status} />
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Client" value={client?.client_name} />
            <Field label="Phone" value={client?.client_phone} />
            <Field label="Scheduled" value={formatDate(ticket.scheduled_date)} />
            <Field label="Service Date" value={formatDate(ticket.service_date)} />
            <Field label="Address" value={client?.address} />
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">System</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Capacity" value={ticket.sys_capacity} />
              <Field
                label="Loading Capacity"
                value={ticket.sys_loading_capacity}
              />
              <Field label="Make" value={ticket.sys_make} />
              <Field label="Model" value={ticket.sys_model} />
              <Field label="Serial No." value={ticket.sys_serial_no} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Battery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Capacity / AH" value={ticket.bat_capacity_ah} />
              <Field label="Make" value={ticket.bat_make} />
              <Field label="Model" value={ticket.bat_model} />
              <Field label="Quantity" value={ticket.bat_qty} />
              <Field label="Battery Bank" value={ticket.bat_bank_nos} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">SPV</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field
                label="Module Capacity"
                value={ticket.spv_module_capacity}
              />
              <Field label="Make" value={ticket.spv_make} />
              <Field label="VOC" value={ticket.spv_voc} />
              <Field label="Total Nos" value={ticket.spv_total_nos} />
              <Field label="Total Watts" value={ticket.spv_total_watts} />
              <Field label="No. of Strings" value={ticket.spv_no_of_strings} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Post-Service Readings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
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

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Battery Voltage" value={ticket.battery_voltage} />
              <Field label="Charging Current" value={ticket.charging_current} />
              <Field
                label="Battery Water Level"
                value={ticket.battery_water_level}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resolution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Nature of Complaint"
              value={ticket.nature_of_complaint}
            />
            <Field label="Defects Found" value={ticket.defects_found} />
            <Field label="Action Taken" value={ticket.action_taken} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Financials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-5 sm:grid-cols-4">
              <Field
                label="Service Charge"
                value={formatCurrency(ticket.service_charge)}
              />
              <Field
                label="Cost of Spares"
                value={formatCurrency(ticket.cost_of_spares)}
              />
              <Field label="AMC Charge" value={formatCurrency(ticket.amc_charge)} />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Total
                </p>
                <p className="mt-0.5 text-lg font-bold text-amber-600">
                  {formatCurrency(ticket.total)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isAdmin && (
          <div className="flex justify-end">
            <form action={deleteTicket}>
              <input type="hidden" name="id" value={ticket.id} />
              <Button type="submit" variant="ghost" className="text-destructive">
                Delete Ticket
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
