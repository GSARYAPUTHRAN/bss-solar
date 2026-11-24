import { jsPDF } from "jspdf";
import { autoTable, type RowInput, type UserOptions } from "jspdf-autotable";
import { COMPANY } from "./constants";
import {
  REPORT_NOTES,
  formatGrowthPlain,
  reportFileName,
  type FigureFormat,
  type MonthlyReport,
} from "./domain/reports";

/**
 * The monthly report as an A4 portrait PDF for the CEO and the team — the same
 * figures as /reports, built in the browser (jsPDF + autotable), never on the
 * server.
 *
 * The standard PDF fonts only cover Latin-1: there is no rupee sign, no arrows
 * and no en dash, so amounts read "Rs. 1,25,000.00", changes "+12.5%", and
 * every string goes through `pdfText` first.
 */

/**
 * Text the standard PDF fonts can print: dashes and minus to "-", ₹ to "Rs.",
 * arrows to signs, and anything else outside Latin-1 to "?".
 */
export function pdfText(value: string): string {
  return value
    .replace(/₹\s?/g, "Rs. ")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/▲\s?/g, "+")
    .replace(/▼\s?/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

/** "Rs. 1,25,000.00" (Indian digit grouping, always two decimals). */
export function pdfMoney(value: number): string {
  const abs = Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-Rs. ${abs}` : `Rs. ${abs}`;
}

function pdfKw(value: number): string {
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kW`;
}

function pdfFigure(value: number, format: FigureFormat): string {
  if (format === "money") return pdfMoney(value);
  if (format === "kw") return pdfKw(value);
  return value.toLocaleString("en-IN");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "24 Nov 2026". */
function pdfDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const MARGIN = 40;
const GREY: [number, number, number] = [90, 90, 90];
const HEAD_FILL: [number, number, number] = [30, 64, 120];

/** Builds (but does not save) the report. */
export function buildReportDoc(report: MonthlyReport): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const { period } = report;

  const text = (
    value: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {},
  ) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 9);
    doc.setTextColor(...(opts.color ?? [0, 0, 0]));
    doc.text(pdfText(value), x, y);
    doc.setTextColor(0, 0, 0);
  };

  // ---- heading ----
  let y = MARGIN + 6;
  text(COMPANY.fullName, MARGIN, y, { size: 16, bold: true });
  y += 18;
  text(
    `Monthly report - ${report.monthLabel}${period.soFar ? " (so far)" : ""}`,
    MARGIN,
    y,
    { size: 12, bold: true },
  );
  y += 14;
  text(
    `Period ${period.current.label}, compared with ${period.previous.label} and ${period.lastYear.label}.`,
    MARGIN,
    y,
    { color: GREY },
  );
  y += 12;
  text(
    `Generated on ${pdfDate(report.generatedOn)}.${period.soFar ? " The month is not over: figures are to date." : ""}`,
    MARGIN,
    y,
    { color: GREY },
  );
  y += 10;

  /** One titled table; returns the y below it. */
  const table = (title: string, options: UserOptions, startY: number): number => {
    let top = startY + 18;
    // Keep a heading with at least a few rows of its table.
    if (top > height - 120) {
      doc.addPage();
      top = MARGIN + 6;
    }
    text(title, MARGIN, top, { size: 11, bold: true });
    autoTable(doc, {
      startY: top + 6,
      margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + 10 },
      theme: "grid",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: HEAD_FILL, textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [235, 238, 244], textColor: 0, fontStyle: "bold" },
      ...options,
      head: options.head?.map(cleanRow),
      body: options.body?.map(cleanRow),
      foot: options.foot?.map(cleanRow),
    });
    return lastTableEnd(doc, top + 20);
  };

  // ---- (a) headline ----
  y = table(
    "Headline figures",
    {
      head: [
        [
          "Figure",
          period.current.label,
          period.previous.label,
          "Change",
          period.lastYear.label,
          "Change",
        ],
      ],
      body: report.kpis.map((k) => [
        k.label,
        pdfFigure(k.value, k.format),
        pdfFigure(k.previous, k.format),
        formatGrowthPlain(k.vsPrevious),
        pdfFigure(k.lastYear, k.format),
        formatGrowthPlain(k.vsLastYear),
      ]),
      columnStyles: rightAligned([1, 2, 3, 4, 5]),
    },
    y,
  );

  // ---- (b) collections ----
  const c = report.current.collections;
  y = table(
    `Collections - ${period.current.label}`,
    {
      head: [["", "Entries", "Amount"]],
      body: [
        ["Advances", String(c.advances.count), pdfMoney(c.advances.amount)],
        ["Contract payments", String(c.contract.count), pdfMoney(c.contract.amount)],
        ["Less refunds", String(c.refunds.count), pdfMoney(-c.refunds.amount)],
        [
          { content: "Net collected", styles: { fontStyle: "bold" } },
          "",
          { content: pdfMoney(c.net), styles: { fontStyle: "bold" } },
        ],
        [{ content: "Not in net collected:", colSpan: 3, styles: { textColor: GREY } }],
        ["KSEB fees collected", String(c.ksebCollected.count), pdfMoney(c.ksebCollected.amount)],
        [
          "KSEB fees paid by the office",
          String(c.ksebByOffice.count),
          pdfMoney(c.ksebByOffice.amount),
        ],
        ["Write-offs (not money)", String(c.writeOffs.count), pdfMoney(c.writeOffs.amount)],
      ],
      columnStyles: rightAligned([1, 2]),
    },
    y,
  );

  // ---- (c) financial year ----
  y = table(
    `Financial year to date - ${period.fyName} vs ${period.fyBaseName}`,
    {
      head: [
        [
          "Figure",
          `${period.fyName} (${period.fy.label})`,
          `${period.fyBaseName} (${period.fyBase.label})`,
          "Change",
        ],
      ],
      body: report.fy.map((r) => [
        r.label,
        pdfFigure(r.value, r.format),
        pdfFigure(r.base, r.format),
        formatGrowthPlain(r.change),
      ]),
      columnStyles: rightAligned([1, 2, 3]),
    },
    y,
  );

  // ---- (d) trend ----
  y = table(
    "12-month trend",
    {
      head: [
        [
          "Month",
          "Sales",
          "Sales value",
          "kW",
          "Net collected",
          "Commissioned",
          "Services",
          "Value MoM",
        ],
      ],
      body: report.trend.map((r) => [
        r.label,
        String(r.salesCount),
        pdfMoney(r.salesValue),
        pdfKw(r.capacityKw),
        pdfMoney(r.netCollected),
        String(r.commissioned),
        String(r.servicesCompleted),
        formatGrowthPlain(r.valueMoM),
      ]),
      columnStyles: rightAligned([1, 2, 3, 4, 5, 6, 7]),
    },
    y,
  );

  // ---- (e) by coordinator ----
  const team = report.coordinators;
  y = table(
    `By coordinator - ${period.current.label}`,
    {
      head: [["Coordinator", "Sales", "Shared", "Value share", "kW share", "Commissioned"]],
      body:
        team.rows.length > 0
          ? team.rows.map((r) => [
              r.name,
              String(r.sales),
              String(r.shared),
              pdfMoney(r.valueShare),
              pdfKw(r.kwShare),
              String(r.commissioned),
            ])
          : [[{ content: "No sales or commissioning in this period.", colSpan: 6 }]],
      foot: [
        [
          "Total",
          String(team.totals.sales),
          String(team.totals.shared),
          pdfMoney(team.totals.value),
          pdfKw(team.totals.kw),
          String(team.totals.commissioned),
        ],
      ],
      columnStyles: rightAligned([1, 2, 3, 4, 5]),
    },
    y,
  );

  // ---- (f) as of today ----
  const s = report.snapshot;
  y = table(
    `As of today (${pdfDate(report.generatedOn)})`,
    {
      head: [["", "Now"]],
      body: [
        ["Active projects", String(s.activeProjects)],
        [
          "Commissioned with a balance due",
          `${s.commissionedUnpaid} (${pdfMoney(s.outstandingAmount)} due)`,
        ],
        ["Incentives pending", pdfMoney(s.incentivePending)],
        ["Open service tickets", String(s.openTickets)],
      ],
      columnStyles: rightAligned([1]),
    },
    y,
  );

  // ---- (g) how the numbers are counted ----
  table(
    "How these numbers are counted",
    {
      theme: "plain",
      body: REPORT_NOTES.map((n) => [
        { content: n.term, styles: { fontStyle: "bold", cellWidth: 110 } },
        n.text,
      ]),
    },
    y,
  );

  // ---- page footer ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    text(
      `${COMPANY.fullName} - Monthly report ${report.monthLabel}`,
      MARGIN,
      height - MARGIN / 2,
      { size: 7, color: GREY },
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(`Page ${i} of ${pages}`, width - MARGIN, height - MARGIN / 2, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }

  return doc;
}

/** Builds the report and triggers the browser download (bss-report-YYYY-MM.pdf). */
export function downloadReportPdf(report: MonthlyReport): void {
  buildReportDoc(report).save(reportFileName("pdf", report.period.month));
}

/** Right-align the given (numeric) columns. */
function rightAligned(columns: number[]): UserOptions["columnStyles"] {
  return Object.fromEntries(columns.map((i) => [i, { halign: "right" as const }]));
}

/** Every string cell made printable (`pdfText`), objects' `content` included. */
function cleanRow(row: RowInput): RowInput {
  if (!Array.isArray(row)) return row;
  return row.map((cell) => {
    if (typeof cell === "string") return pdfText(cell);
    if (cell && typeof cell === "object" && "content" in cell && typeof cell.content === "string") {
      return { ...cell, content: pdfText(cell.content) };
    }
    return cell;
  });
}

/** Where the last table ended (autotable records it on the document). */
function lastTableEnd(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY?: number } | false }).lastAutoTable;
  return last && typeof last.finalY === "number" ? last.finalY : fallback;
}
