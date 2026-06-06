import { jsPDF } from "jspdf";
import { COMPANY } from "./constants";
import { formatDate } from "./format";
import type { ServiceTicket } from "./types";

/**
 * Builds (but does not save) a PDF that mimics the physical BSS Solar /
 * Bharat Sevak Samaj "Installation / Maintenance / AMC" service sheet.
 */
export function buildServiceDoc(ticket: ServiceTicket): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const L = 24;
  const R = W - 24;
  const CW = R - L;

  const client = ticket.project?.work_order;
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const money = (x: number | null | undefined) =>
    x === null || x === undefined ? "" : Number(x).toLocaleString("en-IN");

  doc.setLineWidth(0.7);
  doc.setDrawColor(0);
  doc.setTextColor(0);

  // ---- text helper ----
  const T = (
    s: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; align?: "left" | "center" | "right" } = {},
  ) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 8);
    doc.text(s, x, y, opts.align ? { align: opts.align } : undefined);
  };

  // ---- checkbox helper, returns x after the label ----
  const check = (
    x: number,
    yBase: number,
    label: string,
    checked: boolean,
    size = 8,
    gap = 14,
  ) => {
    doc.rect(x, yBase - 8, 9, 9);
    if (checked) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("X", x + 1.7, yBase - 1);
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.text(label, x + 12, yBase - 1.5);
    return x + 12 + doc.getTextWidth(label) + gap;
  };

  // ---- grid helper ----
  type Cell = {
    text?: string;
    w: number;
    bold?: boolean;
    size?: number;
    align?: "left" | "center";
  };
  const grid = (x: number, y: number, rowH: number, rows: Cell[][]) => {
    let cy = y;
    for (const row of rows) {
      let cx = x;
      for (const cell of row) {
        doc.rect(cx, cy, cell.w, rowH);
        if (cell.text) {
          doc.setFont("helvetica", cell.bold ? "bold" : "normal");
          doc.setFontSize(cell.size ?? 7.5);
          if (cell.align === "center") {
            doc.text(cell.text, cx + cell.w / 2, cy + rowH - 3.5, {
              align: "center",
            });
          } else {
            doc.text(cell.text, cx + 3, cy + rowH - 3.5);
          }
        }
        cx += cell.w;
      }
      cy += rowH;
    }
    return cy;
  };

  // ============ HEADER ============
  const headTop = 24;
  const headH = 88;
  doc.rect(L, headTop, CW, headH);

  // Logo (emblem approximated by a circle)
  const logoX = L + 32;
  const logoY = headTop + 30;
  doc.circle(logoX, logoY, 22);
  T("BHARAT", logoX, logoY - 4, { size: 5, bold: true, align: "center" });
  T("SEVAK", logoX, logoY + 2, { size: 5, bold: true, align: "center" });
  T("SAMAJ", logoX, logoY + 8, { size: 5, bold: true, align: "center" });
  T(COMPANY.website, logoX, headTop + 64, { size: 5.5, align: "center" });
  T(COMPANY.email, logoX, headTop + 73, { size: 5.5, align: "center" });

  const tx = L + 78;
  T(COMPANY.org, tx, headTop + 22, { size: 18, bold: true });
  T(COMPANY.subtitle, tx, headTop + 34, { size: 8.5, bold: true });
  T(COMPANY.line1, tx, headTop + 43, { size: 6.5 });
  T(COMPANY.line2, tx, headTop + 51, { size: 6.5 });
  T(COMPANY.officeLabel, tx, headTop + 62, { size: 6.5, bold: true });
  T(COMPANY.address, tx, headTop + 70, { size: 6.5 });
  T(`Ph. No. : ${COMPANY.phone}`, tx, headTop + 78, { size: 6.5 });

  let y = headTop + headH;

  // Form no (red) in the gap above the customer block
  doc.setTextColor(200, 0, 0);
  T(`No. ${v(ticket.ticket_no)}`, L + 4, y + 14, { size: 11, bold: true });
  doc.setTextColor(0);

  // ============ CUSTOMER BLOCK ============
  const custTop = y + 20;
  const custH = 96;
  const midX = L + 312;
  doc.rect(L, custTop, CW, custH);
  doc.line(midX, custTop, midX, custTop + custH);

  // right-top label
  T("Installation / Maintenance / AMC", R - 5, custTop + 12, {
    size: 8,
    bold: true,
    align: "right",
  });
  doc.line(midX, custTop + 16, R, custTop + 16);

  // left fields
  const lx = L + 5;
  const lrow = (label: string, value: string, yy: number) => {
    T(label, lx, yy, { size: 8 });
    T(value, lx + 70, yy, { size: 8, bold: true });
  };
  lrow("Name :", v(client?.client_name), custTop + 14);
  lrow("Customer ID :", "", custTop + 28);
  lrow("Address :", v(client?.address), custTop + 42);
  lrow("Mob :", v(client?.client_phone), custTop + 56);
  lrow("E-mail ID :", "", custTop + 70);
  lrow("Contact Person :", "", custTop + 84);

  // right fields
  const rx = midX + 6;
  T("Date :", rx, custTop + 30, { size: 8 });
  T(formatDate(ticket.service_date ?? ticket.scheduled_date), rx + 40, custTop + 30, {
    size: 8,
    bold: true,
  });
  T("Ref. No. :", rx, custTop + 44, { size: 8 });

  T("Installed by", rx, custTop + 58, { size: 7.5 });
  let bx = rx + 52;
  bx = check(bx, custTop + 58, "BSS", true, 7, 6);
  bx = check(bx, custTop + 58, "OTH", false, 7, 6);
  bx = check(bx, custTop + 58, "AMC", (ticket.amc_charge ?? 0) > 0, 7, 6);
  check(bx, custTop + 58, "SERVICE", ticket.ticket_type === "adhoc", 7, 4);

  T("Supplied by :", rx, custTop + 72, { size: 8 });

  T("Service at :", rx, custTop + 86, { size: 7.5 });
  let sx = rx + 50;
  sx = check(sx, custTop + 86, "IN HOUSE", false, 7, 6);
  sx = check(sx, custTop + 86, "DEALER", false, 7, 6);
  check(sx, custTop + 86, "ON SITE", true, 7, 4);

  y = custTop + custH;

  // ============ TYPE OF CALL ============
  const tocH = 18;
  doc.rect(L, y, CW, tocH);
  T("TYPE OF CALL :", L + 4, y + 12, { size: 8, bold: true });
  let cxp = L + 88;
  cxp = check(cxp, y + 13, "INSTALLATION", false);
  cxp = check(cxp, y + 13, "AMC", (ticket.amc_charge ?? 0) > 0);
  check(cxp, y + 13, "FREE CHECK UP", ticket.ticket_type === "routine_6m");
  y += tocH;

  // ============ NATURE OF COMPLAINT ============
  const nocH = 16;
  doc.rect(L, y, CW, nocH);
  T("NATURE OF COMPLAINT :", L + 4, y + 11, { size: 8, bold: true });
  T(v(ticket.nature_of_complaint).slice(0, 90), L + 130, y + 11, { size: 8 });
  y += nocH;

  // ============ 3-COLUMN DETAILS ============
  const colW = CW / 3;
  // header
  grid(L, y, 14, [
    [
      { text: "SYSTEM DETAILS", w: colW, bold: true, align: "center", size: 8.5 },
      { text: "BATTERY DETAILS", w: colW, bold: true, align: "center", size: 8.5 },
      { text: "SPV DETAILS", w: colW, bold: true, align: "center", size: 8.5 },
    ],
  ]);
  let dy = y + 14;
  const sys = [
    `Capacity : ${v(ticket.sys_capacity)}`,
    `Loading Capacity : ${v(ticket.sys_loading_capacity)}`,
    `Make : ${v(ticket.sys_make)}`,
    `Model : ${v(ticket.sys_model)}`,
    `Sl. No. : ${v(ticket.sys_serial_no)}`,
  ];
  const bat = [
    `Capacity / AH : ${v(ticket.bat_capacity_ah)}`,
    `Make : ${v(ticket.bat_make)}`,
    `Model : ${v(ticket.bat_model)}`,
    `Qty. : ${v(ticket.bat_qty)}`,
    `No. of Battery Bank : ${v(ticket.bat_bank_nos)}`,
  ];
  const spv = [
    `Module Capacity : ${v(ticket.spv_module_capacity)}`,
    `Make : ${v(ticket.spv_make)}`,
    `VOC : ${v(ticket.spv_voc)}`,
    `Total Nos : ${v(ticket.spv_total_nos)}   Watts : ${v(ticket.spv_total_watts)}`,
    `No. of String : ${v(ticket.spv_no_of_strings)}`,
  ];
  const detRowH = 13;
  for (let i = 0; i < 5; i++) {
    grid(L, dy, detRowH, [
      [
        { text: sys[i], w: colW, size: 7.5 },
        { text: bat[i], w: colW, size: 7.5 },
        { text: spv[i], w: colW, size: 7.5 },
      ],
    ]);
    dy += detRowH;
  }
  y = dy;

  // ============ DEFECTS/ACTION + ESTIMATE ============
  const blkH = 88;
  const estW = 150;
  const leftW = CW - estW;
  doc.rect(L, y, leftW, blkH);
  doc.rect(L + leftW, y, estW, blkH);

  // left: defects + action
  T("Defects found on inspection :", L + 4, y + 12, { size: 8, bold: true });
  const defLines = doc.splitTextToSize(v(ticket.defects_found), leftW - 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(defLines.slice(0, 2), L + 6, y + 23);
  doc.line(L, y + 44, L + leftW, y + 44);
  T("Action Taken :", L + 4, y + 56, { size: 8, bold: true });
  const actLines = doc.splitTextToSize(v(ticket.action_taken), leftW - 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(actLines.slice(0, 3), L + 6, y + 67);

  // right: estimate
  T("Estimate", L + leftW + estW / 2, y + 12, {
    size: 8.5,
    bold: true,
    align: "center",
  });
  const estRowH = 18;
  const estLabelW = estW - 60;
  grid(L + leftW, y + 16, estRowH, [
    [
      { text: "Service Charge", w: estLabelW, size: 7.5 },
      { text: money(ticket.service_charge), w: 60, size: 7.5, align: "center" },
    ],
    [
      { text: "Cost of Spares", w: estLabelW, size: 7.5 },
      { text: money(ticket.cost_of_spares), w: 60, size: 7.5, align: "center" },
    ],
    [
      { text: "AMC Charge (1 year)", w: estLabelW, size: 7.5 },
      { text: money(ticket.amc_charge), w: 60, size: 7.5, align: "center" },
    ],
    [
      { text: "Total", w: estLabelW, size: 8, bold: true },
      { text: money(ticket.total), w: 60, size: 8, bold: true, align: "center" },
    ],
  ]);
  y += blkH;

  // ============ STATUS AFTER SERVICES BAR ============
  const sbH = 17;
  doc.rect(L, y, CW, sbH);
  T("STATUS AFTER SERVICES :", L + 4, y + 12, { size: 8, bold: true });
  let stx = L + 138;
  stx = check(stx, y + 13, "COMPLETED", ticket.status === "completed");
  stx = check(
    stx,
    y + 13,
    "IN COMPLETED",
    ["open", "scheduled", "in_progress"].includes(ticket.status),
  );
  stx = check(stx, y + 13, "STAND BY GIVEN", false);
  check(stx, y + 13, "PCB/INV TAKEN", false);
  y += sbH;

  // ============ PHASE / SPV STRING / MPPT REGION ============
  const phaseW = 230;
  const findSpv = (n: number) =>
    (ticket.spv_string_readings ?? []).find((s) => s.string === n);
  const findMppt = (n: number) =>
    (ticket.mppt_readings ?? []).find((m) => m.mppt === n);

  // Left phase block (R-N / Y-N / B-N / E-N, two columns)
  const phaseRowH = 15;
  const pcw = phaseW / 4;
  grid(L, y, phaseRowH, [
    [
      { text: "R-N", w: pcw, bold: true, size: 8 },
      { text: "", w: pcw },
      { text: "R-N", w: pcw, bold: true, size: 8 },
      { text: "", w: pcw },
    ],
  ]);
  grid(L, y + phaseRowH, phaseRowH, [
    [
      { text: "Y-N", w: pcw, bold: true, size: 8 },
      { text: "", w: pcw },
      { text: "Y-N", w: pcw, bold: true, size: 8 },
      { text: "", w: pcw },
    ],
  ]);
  grid(L, y + phaseRowH * 2, phaseRowH, [
    [
      { text: "B-N", w: pcw, bold: true, size: 8 },
      { text: "", w: pcw },
      { text: "B-N", w: pcw, bold: true, size: 8 },
      { text: "", w: pcw },
    ],
  ]);
  grid(L, y + phaseRowH * 3, phaseRowH, [
    [
      { text: "E-N", w: pcw, bold: true, size: 8 },
      { text: "", w: pcw },
      { text: "E-N", w: pcw, bold: true, size: 8 },
      { text: "", w: pcw },
    ],
  ]);

  // Right SPV STRING table
  const rX = L + phaseW;
  const rW = CW - phaseW;
  const labelColW = 90;
  const cellW = (rW - labelColW) / 5;
  const sRow = (label: string, vals: string[], bold = false) => [
    { text: label, w: labelColW, bold, size: 7.5 } as Cell,
    ...vals.map(
      (t) => ({ text: t, w: cellW, size: 7.5, align: "center" }) as Cell,
    ),
  ];
  grid(rX, y, phaseRowH, [
    sRow("SPV STRING", ["1", "2", "3", "4", "5"], true),
  ]);
  grid(rX, y + phaseRowH, phaseRowH, [
    sRow(
      "VOLTAGE",
      [1, 2, 3, 4, 5].map((n) => v(findSpv(n)?.voltage)),
    ),
  ]);
  grid(rX, y + phaseRowH * 2, phaseRowH, [
    sRow(
      "AMPERE",
      [1, 2, 3, 4, 5].map((n) => v(findSpv(n)?.ampere)),
    ),
  ]);

  // MPPT table (shares the right area, below SPV string)
  const mLabelW = 90;
  const mCellW = (rW - mLabelW) / 4;
  const mRow = (label: string, vals: string[], bold = false) => [
    { text: label, w: mLabelW, bold, size: 7.5 } as Cell,
    ...vals.map(
      (t) => ({ text: t, w: mCellW, size: 7.5, align: "center" }) as Cell,
    ),
  ];
  const mY = y + phaseRowH * 3;
  grid(rX, mY, phaseRowH, [
    mRow("MPPT Details", ["IN VOLT", "IN AMPERE", "OUT PUT", "OUT AMPERE"], true),
  ]);
  grid(rX, mY + phaseRowH, phaseRowH, [
    mRow("MPPT-1", [
      v(findMppt(1)?.in_volt),
      v(findMppt(1)?.in_ampere),
      v(findMppt(1)?.out_volt),
      v(findMppt(1)?.out_ampere),
    ]),
  ]);
  grid(rX, mY + phaseRowH * 2, phaseRowH, [
    mRow("MPPT-2", [
      v(findMppt(2)?.in_volt),
      v(findMppt(2)?.in_ampere),
      v(findMppt(2)?.out_volt),
      v(findMppt(2)?.out_ampere),
    ]),
  ]);
  grid(rX, mY + phaseRowH * 3, phaseRowH, [
    [
      { text: "Battery Panel Sl. No.", w: mLabelW, bold: true, size: 7.5 },
      { text: "", w: rW - mLabelW },
    ],
  ]);

  // Battery check up details (under the phase block on the left)
  const bcY = y + phaseRowH * 4;
  doc.rect(L, bcY, phaseW, 50);
  T("Battery Check up Details", L + 4, bcY + 12, { size: 8, bold: true });
  T(`Battery of Voltage : ${v(ticket.battery_voltage)}`, L + 4, bcY + 25, {
    size: 7.5,
  });
  T(`Charging Current : ${v(ticket.charging_current)}`, L + 4, bcY + 37, {
    size: 7.5,
  });
  T(`Battery Water Level : ${v(ticket.battery_water_level)}`, L + 4, bcY + 47, {
    size: 7.5,
  });

  y = mY + phaseRowH * 4 + 14;

  // ============ FOOTER ============
  T("Customer Feed Back :", L + 4, y + 12, { size: 8, bold: true });
  let fx = L + 120;
  fx = check(fx, y + 13, "Excellent", false);
  fx = check(fx, y + 13, "Good", false);
  fx = check(fx, y + 13, "Satisfactory", false);
  check(fx, y + 13, "Poor", false);
  y += 22;

  T("Customer suggestion if any :", L + 4, y + 10, { size: 8 });
  y += 22;

  // signatures area
  doc.line(L, y, R, y);
  const fMid = L + CW * 0.62;
  T("Customer Name :", L + 4, y + 16, { size: 8 });
  T(v(client?.client_name), L + 90, y + 16, { size: 8, bold: true });
  T("Name of Engineers", fMid + 6, y + 16, { size: 8, bold: true });
  T("1.", fMid + 6, y + 30, { size: 8 });
  T("2.", fMid + 6, y + 44, { size: 8 });
  T("3.", fMid + 6, y + 58, { size: 8 });

  T("Signature :", L + 4, y + 44, { size: 8 });
  T("Seal :", L + 4, y + 72, { size: 8 });
  T("Service Head Signature", fMid + 6, y + 72, { size: 8, bold: true });

  doc.line(fMid, y, fMid, y + 80);

  return doc;
}

/**
 * Builds the service sheet and triggers a browser download.
 */
export function generateServicePdf(ticket: ServiceTicket) {
  const doc = buildServiceDoc(ticket);
  doc.save(`${ticket.ticket_no ?? "BSS-service-report"}.pdf`);
}
