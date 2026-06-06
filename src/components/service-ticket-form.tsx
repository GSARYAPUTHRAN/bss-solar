"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Section, FormActions } from "@/components/layout";
import { FormSelect } from "@/components/form-select";
import { updateTicket } from "@/app/(app)/tickets/actions";
import { formatCurrency } from "@/lib/format";
import { TICKET_STATUS_LABELS, TICKET_TYPE_LABELS } from "@/lib/constants";
import type {
  MpptReading,
  ServiceTicket,
  SpvStringReading,
  TicketStatus,
  TicketType,
} from "@/lib/types";

function Text({
  name,
  label,
  defaultValue,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name} className="text-xs">
        {label}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
      />
    </div>
  );
}

function defaultSpvStrings(t: ServiceTicket): SpvStringReading[] {
  const existing = t.spv_string_readings ?? [];
  return Array.from({ length: 5 }, (_, i) => {
    const found = existing.find((s) => s.string === i + 1);
    return found ?? { string: i + 1, voltage: "", ampere: "" };
  });
}

function defaultMppt(t: ServiceTicket): MpptReading[] {
  const existing = t.mppt_readings ?? [];
  return Array.from({ length: 2 }, (_, i) => {
    const found = existing.find((m) => m.mppt === i + 1);
    return (
      found ?? {
        mppt: i + 1,
        in_volt: "",
        out_volt: "",
        in_ampere: "",
        out_ampere: "",
      }
    );
  });
}

export function ServiceTicketForm({ ticket }: { ticket: ServiceTicket }) {
  const [spv, setSpv] = useState<SpvStringReading[]>(defaultSpvStrings(ticket));
  const [mppt, setMppt] = useState<MpptReading[]>(defaultMppt(ticket));
  const [serviceCharge, setServiceCharge] = useState(
    Number(ticket.service_charge ?? 0),
  );
  const [costOfSpares, setCostOfSpares] = useState(
    Number(ticket.cost_of_spares ?? 0),
  );
  const [amcCharge, setAmcCharge] = useState(Number(ticket.amc_charge ?? 0));

  const total = serviceCharge + costOfSpares + amcCharge;

  const updateSpv = (i: number, key: keyof SpvStringReading, val: string) => {
    setSpv((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)),
    );
  };
  const updateMppt = (i: number, key: keyof MpptReading, val: string) => {
    setMppt((prev) =>
      prev.map((m, idx) => (idx === i ? { ...m, [key]: val } : m)),
    );
  };

  return (
    <form action={updateTicket} className="space-y-5">
      <input type="hidden" name="id" value={ticket.id} />
      <input
        type="hidden"
        name="spv_string_readings"
        value={JSON.stringify(spv)}
      />
      <input type="hidden" name="mppt_readings" value={JSON.stringify(mppt)} />

      <Section
        title="Service Information"
        contentClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
          <div className="space-y-1.5">
            <Label className="text-xs">Ticket type</Label>
            <FormSelect
              name="ticket_type"
              defaultValue={ticket.ticket_type}
              options={(Object.keys(TICKET_TYPE_LABELS) as TicketType[]).map(
                (t) => ({ value: t, label: TICKET_TYPE_LABELS[t] }),
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <FormSelect
              name="status"
              defaultValue={ticket.status}
              options={(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map(
                (s) => ({ value: s, label: TICKET_STATUS_LABELS[s] }),
              )}
            />
          </div>
          <Text
            name="scheduled_date"
            label="Scheduled date"
            type="date"
            defaultValue={ticket.scheduled_date}
          />
          <Text
            name="service_date"
            label="Service date"
            type="date"
            defaultValue={ticket.service_date}
          />
      </Section>

      <Section
        title="System Details"
        contentClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
          <Text name="sys_capacity" label="Capacity" defaultValue={ticket.sys_capacity} />
          <Text
            name="sys_loading_capacity"
            label="Loading Capacity"
            defaultValue={ticket.sys_loading_capacity}
          />
          <Text name="sys_make" label="Make" defaultValue={ticket.sys_make} />
          <Text name="sys_model" label="Model" defaultValue={ticket.sys_model} />
          <Text
            name="sys_serial_no"
            label="Serial No."
            defaultValue={ticket.sys_serial_no}
          />
      </Section>

      <Section
        title="Battery Details"
        contentClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
          <Text
            name="bat_capacity_ah"
            label="Capacity / AH"
            defaultValue={ticket.bat_capacity_ah}
          />
          <Text name="bat_make" label="Make" defaultValue={ticket.bat_make} />
          <Text name="bat_model" label="Model" defaultValue={ticket.bat_model} />
          <Text
            name="bat_qty"
            label="Quantity"
            type="number"
            defaultValue={ticket.bat_qty}
          />
          <Text
            name="bat_bank_nos"
            label="No. of Battery Bank"
            type="number"
            defaultValue={ticket.bat_bank_nos}
          />
      </Section>

      <Section
        title="SPV (Solar Panel) Details"
        contentClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
          <Text
            name="spv_module_capacity"
            label="Module Capacity"
            defaultValue={ticket.spv_module_capacity}
          />
          <Text name="spv_make" label="Make" defaultValue={ticket.spv_make} />
          <Text name="spv_voc" label="VOC" defaultValue={ticket.spv_voc} />
          <Text
            name="spv_total_nos"
            label="Total Nos"
            type="number"
            defaultValue={ticket.spv_total_nos}
          />
          <Text
            name="spv_total_watts"
            label="Total Watts"
            type="number"
            defaultValue={ticket.spv_total_watts}
          />
          <Text
            name="spv_no_of_strings"
            label="No. of Strings"
            type="number"
            defaultValue={ticket.spv_no_of_strings}
          />
      </Section>

      <Section title="Post-Service Status" contentClassName="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">SPV String Readings</p>
            <div className="space-y-2">
              {spv.map((s, i) => (
                <div key={s.string} className="flex items-center gap-2">
                  <span className="w-20 text-xs text-muted-foreground">
                    String {s.string}
                  </span>
                  <Input
                    placeholder="Voltage (V)"
                    value={s.voltage}
                    onChange={(e) => updateSpv(i, "voltage", e.target.value)}
                  />
                  <Input
                    placeholder="Ampere (A)"
                    value={s.ampere}
                    onChange={(e) => updateSpv(i, "ampere", e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">MPPT Readings</p>
            <div className="space-y-2">
              {mppt.map((m, i) => (
                <div
                  key={m.mppt}
                  className="grid grid-cols-2 items-center gap-2 sm:grid-cols-5"
                >
                  <span className="text-xs text-muted-foreground">
                    MPPT {m.mppt}
                  </span>
                  <Input
                    placeholder="In Volt"
                    value={m.in_volt}
                    onChange={(e) => updateMppt(i, "in_volt", e.target.value)}
                  />
                  <Input
                    placeholder="Out Volt"
                    value={m.out_volt}
                    onChange={(e) => updateMppt(i, "out_volt", e.target.value)}
                  />
                  <Input
                    placeholder="In Ampere"
                    value={m.in_ampere}
                    onChange={(e) => updateMppt(i, "in_ampere", e.target.value)}
                  />
                  <Input
                    placeholder="Out Ampere"
                    value={m.out_ampere}
                    onChange={(e) => updateMppt(i, "out_ampere", e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Text
              name="battery_voltage"
              label="Battery Voltage"
              defaultValue={ticket.battery_voltage}
            />
            <Text
              name="charging_current"
              label="Charging Current"
              defaultValue={ticket.charging_current}
            />
            <Text
              name="battery_water_level"
              label="Battery Water Level"
              defaultValue={ticket.battery_water_level}
            />
          </div>
      </Section>

      <Section title="Resolution" contentClassName="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nature_of_complaint" className="text-xs">
              Nature of Complaint
            </Label>
            <Textarea
              id="nature_of_complaint"
              name="nature_of_complaint"
              rows={2}
              defaultValue={ticket.nature_of_complaint ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="defects_found" className="text-xs">
              Defects Found
            </Label>
            <Textarea
              id="defects_found"
              name="defects_found"
              rows={2}
              defaultValue={ticket.defects_found ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="action_taken" className="text-xs">
              Action Taken
            </Label>
            <Textarea
              id="action_taken"
              name="action_taken"
              rows={2}
              defaultValue={ticket.action_taken ?? ""}
            />
          </div>
      </Section>

      <Section
        title="Financials"
        contentClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
          <div className="space-y-1.5">
            <Label htmlFor="service_charge" className="text-xs">
              Service Charge
            </Label>
            <Input
              id="service_charge"
              name="service_charge"
              type="number"
              step="0.01"
              value={serviceCharge}
              onChange={(e) => setServiceCharge(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cost_of_spares" className="text-xs">
              Cost of Spares
            </Label>
            <Input
              id="cost_of_spares"
              name="cost_of_spares"
              type="number"
              step="0.01"
              value={costOfSpares}
              onChange={(e) => setCostOfSpares(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amc_charge" className="text-xs">
              AMC Charge
            </Label>
            <Input
              id="amc_charge"
              name="amc_charge"
              type="number"
              step="0.01"
              value={amcCharge}
              onChange={(e) => setAmcCharge(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Total</Label>
            <div className="flex h-9 items-center rounded-md border bg-primary/5 px-3 text-sm font-semibold text-primary">
              {formatCurrency(total)}
            </div>
          </div>
      </Section>

      <FormActions>
        <Button type="submit">Save Service Sheet</Button>
      </FormActions>
    </form>
  );
}
