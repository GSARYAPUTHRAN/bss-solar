import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords } from "./csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsv('name,addr\n"Nair","Vytilla, Kochi"')).toEqual([
      ["name", "addr"],
      ["Nair", "Vytilla, Kochi"],
    ]);
  });

  it("handles escaped quotes and CRLF", () => {
    expect(parseCsv('a\r\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  it("drops fully empty rows", () => {
    expect(parseCsv("a\n\n\nb")).toEqual([["a"], ["b"]]);
  });
});

describe("parseCsvRecords", () => {
  it("keys rows by lower-cased header", () => {
    const res = parseCsvRecords("Client_Name,Total\nAnand,195000");
    expect("records" in res && res.records).toEqual([
      { client_name: "Anand", total: "195000" },
    ]);
  });

  it("errors on empty input", () => {
    expect(parseCsvRecords("")).toEqual({ error: expect.any(String) });
  });
});
