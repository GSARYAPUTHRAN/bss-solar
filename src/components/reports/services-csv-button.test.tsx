// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServicesCsvButton } from "./services-csv-button";

const CSV = 'ticket_no,service_date,customer,engineer,type,total\nBSS-2611-1001,2026-11-10,"Nair, K",Anil Kumar,Ad-hoc,1850.00';

let blobs: Blob[];
let downloads: { href: string; download: string }[];

beforeEach(() => {
  blobs = [];
  downloads = [];
  // jsdom has no object URLs and does not navigate on an anchor click.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:report";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.getAttribute("href") ?? "", download: this.download });
  });
});

afterEach(() => vi.restoreAllMocks());

/** A Blob's bytes as UTF-8 text, BOM and all. */
async function bytesOf(blob: Blob): Promise<string> {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await blob.arrayBuffer());
}

describe("ServicesCsvButton", () => {
  it("downloads the CSV under the period's file name", async () => {
    render(<ServicesCsvButton csv={CSV} filename="bss-services-2026-11.csv" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Services (CSV)" }));

    expect(downloads).toEqual([{ href: "blob:report", download: "bss-services-2026-11.csv" }]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");
  });

  it("starts the file with a UTF-8 byte-order mark so Excel reads it right", async () => {
    render(<ServicesCsvButton csv={CSV} filename="bss-services-all.csv" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Services (CSV)" }));

    const text = await bytesOf(blobs[0]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe(CSV);
  });

  it("lets go of the file once the download has started", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      render(<ServicesCsvButton csv={CSV} filename="bss-services-all.csv" />);
      screen.getByRole("button", { name: "Services (CSV)" }).click();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
      // The temporary link is not left in the page.
      expect(document.querySelector("a[download]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still downloads a period with no visits — the header row alone", async () => {
    render(<ServicesCsvButton csv="ticket_no,service_date" filename="bss-services-2026-01.csv" />);
    const button = screen.getByRole("button", { name: "Services (CSV)" });
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    expect(downloads).toHaveLength(1);
  });

  it("is a phone-sized tap target", () => {
    render(<ServicesCsvButton csv={CSV} filename="x.csv" />);
    expect(screen.getByRole("button", { name: "Services (CSV)" })).toHaveClass("h-10");
  });
});
