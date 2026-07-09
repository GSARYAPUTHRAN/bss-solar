// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildServiceDoc } from "./pdf";
import type { ServiceTicket } from "./types";

function ticket(overrides: Partial<ServiceTicket> = {}): ServiceTicket {
  return {
    id: "t1",
    project_id: "p1",
    ticket_no: "BSS-2607-0001",
    ticket_type: "routine_6m",
    status: "completed",
    assigned_to: null,
    scheduled_date: "2026-07-01",
    service_date: "2026-07-02",
    sys_capacity: "5kW",
    sys_loading_capacity: null,
    sys_make: "Luminous",
    sys_model: "NXG",
    sys_serial_no: "SN1",
    bat_capacity_ah: "150AH",
    bat_make: "Exide",
    bat_model: null,
    bat_qty: 2,
    bat_bank_nos: 1,
    spv_module_capacity: "545W",
    spv_make: "Adani",
    spv_voc: "40",
    spv_total_nos: 6,
    spv_total_watts: 3270,
    spv_no_of_strings: 1,
    spv_string_readings: [{ string: 1, voltage: "385", ampere: "7.8" }],
    mppt_readings: [
      { mppt: 1, in_volt: "390", out_volt: "230", in_ampere: "7.5", out_ampere: "12.8" },
    ],
    battery_voltage: "26.4",
    charging_current: "11.2",
    battery_water_level: "Normal",
    nature_of_complaint: "Routine 6-month check",
    defects_found: "None",
    action_taken: "Cleaned panels",
    service_charge: 1500,
    cost_of_spares: 350,
    amc_charge: 0,
    total: 1850,
    created_by: null,
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
    project: {
      id: "p1",
      work_order_id: "w1",
      work_order: { client_name: "Test Client", address: "Kochi", client_phone: "123" },
    },
    ...overrides,
  } as ServiceTicket;
}

describe("buildServiceDoc", () => {
  it("renders a fully populated ticket without throwing", () => {
    const doc = buildServiceDoc(ticket());
    expect(typeof doc.output("datauristring")).toBe("string");
  });

  it("handles a sparse ticket (null project, empty readings, no ticket_no)", () => {
    const doc = buildServiceDoc(
      ticket({
        project: null,
        ticket_no: null,
        spv_string_readings: [],
        mppt_readings: [],
        nature_of_complaint: null,
        defects_found: null,
        action_taken: null,
      }),
    );
    expect(doc).toBeTruthy();
    expect(typeof doc.output("datauristring")).toBe("string");
  });
});
