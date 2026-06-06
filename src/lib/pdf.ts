import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { COMPANY, TICKET_TYPE_LABELS, TICKET_STATUS_LABELS } from "./constants";
import { formatCurrency, formatDate } from "./format";
import type { ServiceTicket } from "./types";

type DocWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

const ACCENT: [number, number, number] = [217, 119, 6]; // amber-600
const DARK: [number, number, number] = [33, 33, 33];
const MUTED: [number, number, number] = [120, 120, 120];

function dash(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  return String(v);
}

export function generateServicePdf(ticket: ServiceTicket) {
  const doc = new jsPDF({ unit: "pt", format: "a4" }) as DocWithTable;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const client = ticket.project?.work_order;

  // ---- Header ----
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, pageWidth, 6, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...DARK);
  doc.text(COMPANY.name, margin, 48);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(COMPANY.tagline, margin, 63);
  doc.text(`${COMPANY.address}  |  ${COMPANY.email}`, margin, 75);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...ACCENT);
  doc.text("SERVICE REPORT", pageWidth - margin, 48, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text(
    `Report No: ${dash(ticket.ticket_no)}`,
    pageWidth - margin,
    63,
    { align: "right" },
  );
  doc.text(
    `Type: ${TICKET_TYPE_LABELS[ticket.ticket_type]}`,
    pageWidth - margin,
    75,
    { align: "right" },
  );
  doc.text(
    `Service Date: ${formatDate(ticket.service_date ?? ticket.scheduled_date)}`,
    pageWidth - margin,
    87,
    { align: "right" },
  );

  // ---- Client / Site box ----
  autoTable(doc, {
    startY: 100,
    theme: "grid",
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 4, textColor: DARK },
    headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontStyle: "bold" },
    head: [["Customer / Site Details", ""]],
    body: [
      ["Client Name", dash(client?.client_name)],
      ["Phone", dash(client?.client_phone)],
      ["Address", dash(client?.address)],
      ["Status", TICKET_STATUS_LABELS[ticket.status]],
    ],
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 130 } },
  });

  const sectionTable = (
    title: string,
    rows: [string, string][],
  ) => {
    const startY = (doc.lastAutoTable?.finalY ?? 100) + 14;
    autoTable(doc, {
      startY,
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 4, textColor: DARK },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
      head: [[title, ""]],
      body: rows,
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 160 } },
    });
  };

  // ---- System Details ----
  sectionTable("System Details", [
    ["Capacity", dash(ticket.sys_capacity)],
    ["Loading Capacity", dash(ticket.sys_loading_capacity)],
    ["Make", dash(ticket.sys_make)],
    ["Model", dash(ticket.sys_model)],
    ["Serial No.", dash(ticket.sys_serial_no)],
  ]);

  // ---- Battery Details ----
  sectionTable("Battery Details", [
    ["Capacity / AH", dash(ticket.bat_capacity_ah)],
    ["Make", dash(ticket.bat_make)],
    ["Model", dash(ticket.bat_model)],
    ["Quantity", dash(ticket.bat_qty)],
    ["No. of Battery Bank", dash(ticket.bat_bank_nos)],
  ]);

  // ---- SPV Details ----
  sectionTable("SPV (Solar Panel) Details", [
    ["Module Capacity", dash(ticket.spv_module_capacity)],
    ["Make", dash(ticket.spv_make)],
    ["VOC", dash(ticket.spv_voc)],
    ["Total Nos", dash(ticket.spv_total_nos)],
    ["Total Watts", dash(ticket.spv_total_watts)],
    ["No. of Strings", dash(ticket.spv_no_of_strings)],
  ]);

  // ---- Post-Service: SPV String readings ----
  const spvRows = (ticket.spv_string_readings ?? []).map((s) => [
    `String ${s.string}`,
    dash(s.voltage),
    dash(s.ampere),
  ]);
  if (spvRows.length) {
    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY ?? 100) + 14,
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 4, textColor: DARK },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
      head: [["SPV String", "Voltage (V)", "Ampere (A)"]],
      body: spvRows,
    });
  }

  // ---- Post-Service: MPPT readings ----
  const mpptRows = (ticket.mppt_readings ?? []).map((m) => [
    `MPPT ${m.mppt}`,
    dash(m.in_volt),
    dash(m.out_volt),
    dash(m.in_ampere),
    dash(m.out_ampere),
  ]);
  if (mpptRows.length) {
    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY ?? 100) + 14,
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 4, textColor: DARK },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
      head: [["MPPT", "In Volt", "Out Volt", "In Ampere", "Out Ampere"]],
      body: mpptRows,
    });
  }

  // ---- Post-Service: Battery status ----
  sectionTable("Post-Service Battery Status", [
    ["Battery Voltage", dash(ticket.battery_voltage)],
    ["Charging Current", dash(ticket.charging_current)],
    ["Battery Water Level", dash(ticket.battery_water_level)],
  ]);

  // ---- Resolution ----
  sectionTable("Resolution", [
    ["Nature of Complaint", dash(ticket.nature_of_complaint)],
    ["Defects Found", dash(ticket.defects_found)],
    ["Action Taken", dash(ticket.action_taken)],
  ]);

  // ---- Financials ----
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY ?? 100) + 14,
    theme: "grid",
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 4, textColor: DARK },
    headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontStyle: "bold" },
    head: [["Charges", "Amount"]],
    body: [
      ["Service Charge", formatCurrency(ticket.service_charge)],
      ["Cost of Spares", formatCurrency(ticket.cost_of_spares)],
      ["AMC Charge", formatCurrency(ticket.amc_charge)],
    ],
    foot: [["Total", formatCurrency(ticket.total)]],
    footStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" } },
  });

  // ---- Signatures ----
  let y = (doc.lastAutoTable?.finalY ?? 100) + 60;
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 80) {
    doc.addPage();
    y = 80;
  }
  doc.setDrawColor(...MUTED);
  doc.line(margin, y, margin + 160, y);
  doc.line(pageWidth - margin - 160, y, pageWidth - margin, y);
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Service Technician", margin, y + 14);
  doc.text("Customer Signature", pageWidth - margin - 160, y + 14);

  doc.setFontSize(8);
  doc.text(
    `Generated by ${COMPANY.name} Operations Console on ${formatDate(new Date().toISOString())}`,
    pageWidth / 2,
    pageHeight - 24,
    { align: "center" },
  );

  doc.save(`${ticket.ticket_no ?? "service-report"}.pdf`);
}
