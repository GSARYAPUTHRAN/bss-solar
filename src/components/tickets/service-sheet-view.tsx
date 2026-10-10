import { Field, FieldGrid, Section } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import type { ServiceTicket } from "@/lib/types";

/**
 * The read-only service sheet: equipment, post-service readings, resolution
 * and charges. Shared by the office and engineer ticket pages so both always
 * show the same record; editing happens only in ServiceTicketForm (office).
 */
export function ServiceSheetView({
  ticket,
  hideComplaint = false,
}: {
  ticket: ServiceTicket;
  /** When the page already shows the complaint more prominently. */
  hideComplaint?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Section title="System" contentClassName="space-y-3">
          <Field label="Capacity" value={ticket.sys_capacity} />
          <Field label="Loading Capacity" value={ticket.sys_loading_capacity} />
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
          <Field label="Module Capacity" value={ticket.spv_module_capacity} />
          <Field label="Make" value={ticket.spv_make} />
          <Field label="VOC" value={ticket.spv_voc} />
          <Field label="Total Nos" value={ticket.spv_total_nos} />
          <Field label="Total Watts" value={ticket.spv_total_watts} />
          <Field label="No. of Strings" value={ticket.spv_no_of_strings} />
        </Section>
      </div>

      <ReadingsSection ticket={ticket} />

      <Section title="Resolution" contentClassName="space-y-4">
        {!hideComplaint && (
          <Field label="Nature of Complaint" value={ticket.nature_of_complaint} />
        )}
        <Field label="Defects Found" value={ticket.defects_found} />
        <Field label="Action Taken" value={ticket.action_taken} />
      </Section>

      <Section title="Charges">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
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
    </div>
  );
}

function ReadingsSection({ ticket }: { ticket: ServiceTicket }) {
  const strings = ticket.spv_string_readings ?? [];
  const mppts = ticket.mppt_readings ?? [];

  return (
    <Section title="Post-Service Readings" contentClassName="space-y-5">
      {strings.length > 0 && (
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
              {strings.map((s) => (
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

      {mppts.length > 0 && (
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
              {mppts.map((m) => (
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
        <Field label="Battery Water Level" value={ticket.battery_water_level} />
      </FieldGrid>
    </Section>
  );
}
