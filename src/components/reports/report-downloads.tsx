"use client";

import { useState } from "react";
import { FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  collectionsCsvRows,
  reportFileName,
  salesCsvRows,
  trendCsvRows,
  type MonthlyReport,
} from "@/lib/domain/reports";
import { downloadCsv } from "./download-file";

/**
 * The report's downloads, all built in the browser from the figures already on
 * the page: the executive PDF and three CSVs (sales, collections, the trend).
 */
export function ReportDownloads({ report }: { report: MonthlyReport }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const { month } = report.period;

  async function downloadPdf() {
    try {
      setPdfBusy(true);
      // jsPDF is large: load it only when a PDF is asked for.
      const { downloadReportPdf } = await import("@/lib/report-pdf");
      downloadReportPdf(report);
      toast.success("Report PDF downloaded");
    } catch (e) {
      toast.error("Could not create the PDF. Please try again.");
      console.error(e);
    } finally {
      setPdfBusy(false);
    }
  }

  function csv(file: "sales" | "collections" | "trend") {
    const rows =
      file === "sales"
        ? salesCsvRows(report.sales)
        : file === "collections"
          ? collectionsCsvRows(report.collections)
          : trendCsvRows(report.trend);
    downloadCsv(reportFileName(file, month), rows);
  }

  const button = "h-10 w-full sm:h-8 sm:w-auto";
  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
      <Button onClick={downloadPdf} disabled={pdfBusy} className={`${button} col-span-2`}>
        {pdfBusy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileDown className="mr-2 h-4 w-4" />
        )}
        Download PDF
      </Button>
      <Button variant="outline" className={button} onClick={() => csv("sales")}>
        <FileSpreadsheet className="mr-1.5 h-4 w-4" />
        Sales (CSV)
      </Button>
      <Button variant="outline" className={button} onClick={() => csv("collections")}>
        <FileSpreadsheet className="mr-1.5 h-4 w-4" />
        Collections (CSV)
      </Button>
      <Button variant="outline" className={`${button} col-span-2`} onClick={() => csv("trend")}>
        <FileSpreadsheet className="mr-1.5 h-4 w-4" />
        12-month trend (CSV)
      </Button>
    </div>
  );
}
