// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadCsv } from "./download-file";

afterEach(() => vi.restoreAllMocks());

describe("downloadCsv", () => {
  it("saves UTF-8 CSV text with a byte-order mark under the given name", async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:report";
    });
    URL.revokeObjectURL = vi.fn();
    const clicked: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ name: this.download, href: this.href });
    });

    downloadCsv("bss-sales-2026-11.csv", [
      ["client_name", "amount"],
      ['Anand, "Kumar"', "1000.00"],
    ]);

    expect(clicked).toEqual([{ name: "bss-sales-2026-11.csv", href: "blob:report" }]);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe(
      'client_name,amount\n"Anand, ""Kumar""",1000.00',
    );
    // The link is not left in the page.
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
