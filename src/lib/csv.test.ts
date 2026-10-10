import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual({
      rows: [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ],
    });
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsv('name,addr\n"Nair","Vytilla, Kochi"')).toEqual({
      rows: [
        ["name", "addr"],
        ["Nair", "Vytilla, Kochi"],
      ],
    });
  });

  it("handles escaped quotes and CRLF", () => {
    expect(parseCsv('a\r\n"say ""hi"""')).toEqual({ rows: [["a"], ['say "hi"']] });
  });

  it("drops fully empty rows", () => {
    expect(parseCsv("a\n\n\nb")).toEqual({ rows: [["a"], ["b"]] });
  });

  it("strips the byte-order mark Excel's CSV UTF-8 export writes", () => {
    expect(parseCsv("﻿client_name,total\nAnand,1")).toEqual({
      rows: [
        ["client_name", "total"],
        ["Anand", "1"],
      ],
    });
  });

  it("reads a quote inside an unquoted cell as an ordinary character", () => {
    const text = [
      "client_name,notes,consumer_number",
      'Anand,Needs 2" conduit,111',
      "Meera,,222",
      'Joseph,say "hi",333',
    ].join("\n");
    expect(parseCsv(text)).toEqual({
      rows: [
        ["client_name", "notes", "consumer_number"],
        ["Anand", 'Needs 2" conduit', "111"],
        ["Meera", "", "222"],
        ["Joseph", 'say "hi"', "333"],
      ],
    });
  });

  it("allows spaces around a quoted field", () => {
    expect(parseCsv('a, "Vytilla, Kochi" ,c')).toEqual({
      rows: [["a", "Vytilla, Kochi", "c"]],
    });
  });

  it("refuses a quote that never closes, naming the line it opened on", () => {
    expect(parseCsv('a,b\n1,"Vytilla, Kochi\n2,3\n4,5')).toEqual({
      error: expect.stringMatching(/^Unclosed quote starting on line 2\b/),
    });
    // Lines are counted through CRLF endings and multi-line quoted values.
    expect(parseCsv('a\r\n"two\r\nlines"\r\n"open\r\nb')).toEqual({
      error: expect.stringMatching(/^Unclosed quote starting on line 4\b/),
    });
  });

  it("refuses text after a closing quote", () => {
    expect(parseCsv('a,b\n"2" conduit,x')).toEqual({
      error: expect.stringMatching(/^Unexpected text after a closing quote on line 2\b/),
    });
  });
});

describe("parseCsvRecords", () => {
  it("keys rows by lower-cased header", () => {
    const res = parseCsvRecords("Client_Name,Total\nAnand,195000");
    expect("records" in res && res.records).toEqual([
      { cells: { client_name: "Anand", total: "195000" } },
    ]);
  });

  it("returns the header row as written, duplicates and blanks included", () => {
    const res = parseCsvRecords(" A ,b,,a\n1,2,3,4");
    expect("headers" in res && res.headers).toEqual(["a", "b", "", "a"]);
  });

  it("fills missing trailing cells with empty strings", () => {
    const res = parseCsvRecords("a,b,c\n1");
    expect("records" in res && res.records).toEqual([{ cells: { a: "1", b: "", c: "" } }]);
  });

  it("errors on empty input", () => {
    expect(parseCsvRecords("")).toEqual({ error: expect.any(String) });
  });

  it("treats the first non-blank line as the header", () => {
    const res = parseCsvRecords(",,\nname\nAnand");
    expect("records" in res && res.records).toEqual([{ cells: { name: "Anand" } }]);
  });

  it("passes malformed quoting through as the error", () => {
    expect(parseCsvRecords('name,notes\nAnand,"open')).toEqual({
      error: expect.stringMatching(/^Unclosed quote starting on line 2\b/),
    });
  });

  it("flags a row with values past the header's last column, quoting them", () => {
    const res = parseCsvRecords("a,b,c\n1,2,NEFT, SBIN0001234\n4,5,6");
    expect("records" in res && res.records).toEqual([
      {
        cells: { a: "1", b: "2", c: "NEFT" },
        problem:
          'Row has 4 cells but the header has 3 — put values that contain commas in double quotes (past the last column: "SBIN0001234")',
      },
      { cells: { a: "4", b: "5", c: "6" } },
    ]);
  });

  it("ignores blank cells past the header, such as a spreadsheet's trailing commas", () => {
    const res = parseCsvRecords("a,b,c\n1,2,3,, \n4,5,6,");
    expect("records" in res && res.records.map((r) => r.problem)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("measures the header to its last named column", () => {
    // Trailing blank header cells hold nothing, so a value under one is extra.
    const res = parseCsvRecords("a,b,c,,\n1,2,3,,Kochi");
    expect("records" in res && res.records[0].problem).toMatch(
      /^Row has 5 cells but the header has 3 .*\(past the last column: "Kochi"\)$/,
    );
  });
});

describe("toCsv", () => {
  it("leaves plain cells unquoted", () => {
    expect(toCsv([["a", "b"], ["1", "+91 98470 11111"]])).toBe(
      "a,b\n1,+91 98470 11111",
    );
  });

  it("quotes commas, quotes, newlines and edge whitespace", () => {
    expect(toCsv([["Vytilla, Kochi", 'say "hi"', "two\nlines", " pad"]])).toBe(
      '"Vytilla, Kochi","say ""hi""","two\nlines"," pad"',
    );
  });

  it("round-trips through parseCsv cell-for-cell", () => {
    const rows = [
      ["client_name", "address", "notes"],
      ["Meera Nair", "Kowdiar, Thiruvananthapuram", 'Said "call after 5"'],
      ["Anand", "", "line one\nline two"],
      ["Joseph", '"quoted" at the start', ' 2" conduit '],
    ];
    expect(parseCsv(toCsv(rows))).toEqual({ rows });
  });
});
