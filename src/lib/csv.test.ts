import { describe, it, expect } from "vitest";
import { decodeCsvBytes, parseCsv, parseCsvRecords, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual({
      rows: [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ],
      lines: [1, 2],
    });
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsv('name,addr\n"Nair","Vytilla, Kochi"')).toEqual({
      rows: [
        ["name", "addr"],
        ["Nair", "Vytilla, Kochi"],
      ],
      lines: [1, 2],
    });
  });

  it("handles escaped quotes and CRLF", () => {
    expect(parseCsv('a\r\n"say ""hi"""')).toEqual({
      rows: [["a"], ['say "hi"']],
      lines: [1, 2],
    });
  });

  it("drops fully empty rows, and the lines they took up are still counted", () => {
    expect(parseCsv("a\n\n\nb")).toEqual({ rows: [["a"], ["b"]], lines: [1, 4] });
  });

  it("strips the byte-order mark Excel's CSV UTF-8 export writes", () => {
    expect(parseCsv("﻿client_name,total\nAnand,1")).toEqual({
      rows: [
        ["client_name", "total"],
        ["Anand", "1"],
      ],
      lines: [1, 2],
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
      lines: [1, 2, 3, 4],
    });
  });

  it("allows spaces around a quoted field", () => {
    expect(parseCsv('a, "Vytilla, Kochi" ,c')).toEqual({
      rows: [["a", "Vytilla, Kochi", "c"]],
      lines: [1],
    });
  });

  describe("the line each row starts on", () => {
    const linesOf = (text: string) => {
      const res = parseCsv(text);
      if ("error" in res) throw new Error(res.error);
      return res.lines;
    };

    it("skips blank, all-comma and whitespace-only lines without losing count", () => {
      // Excel writes a spacer row as commas; a stray space is as blank.
      expect(linesOf("a,b\n1,2\n\n,\n  \n3,4\n,,\n5,6")).toEqual([1, 2, 6, 8]);
    });

    it("counts every line of a quoted value that spans several", () => {
      const text = 'a,b\n1,"line one\nline two\nline three"\n\n2,z\n3,y';
      expect(parseCsv(text)).toEqual({
        rows: [
          ["a", "b"],
          ["1", "line one\nline two\nline three"],
          ["2", "z"],
          ["3", "y"],
        ],
        lines: [1, 2, 6, 7],
      });
    });

    it("counts a quoted value that is blank but spans lines, and one that opens the row", () => {
      expect(linesOf('a\n"\n"\n"x\ny",1\nb')).toEqual([1, 4, 6]);
    });

    it("counts CRLF and a lone CR as one line end each, in and out of quotes", () => {
      expect(linesOf('a\r\n\r\nb\r"c\r\nd"\re')).toEqual([1, 3, 4, 6]);
    });

    it("starts at the first line even when the lines above the header are blank", () => {
      expect(linesOf("\n\nname\nAnand")).toEqual([3, 4]);
    });

    it("is the same with or without a trailing newline", () => {
      expect(linesOf("a\nb")).toEqual([1, 2]);
      expect(linesOf("a\nb\n")).toEqual([1, 2]);
      expect(linesOf("a\nb\n\n\n")).toEqual([1, 2]);
    });

    it("keeps one line per row", () => {
      const res = parseCsv("a\n\nb\n,\nc");
      expect("rows" in res && res.rows.length === res.lines.length).toBe(true);
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
      { cells: { client_name: "Anand", total: "195000" }, line: 2 },
    ]);
  });

  it("returns the header row as written, duplicates and blanks included", () => {
    const res = parseCsvRecords(" A ,b,,a\n1,2,3,4");
    expect("headers" in res && res.headers).toEqual(["a", "b", "", "a"]);
  });

  it("fills missing trailing cells with empty strings", () => {
    const res = parseCsvRecords("a,b,c\n1");
    expect("records" in res && res.records).toEqual([
      { cells: { a: "1", b: "", c: "" }, line: 2 },
    ]);
  });

  it("errors on empty input", () => {
    expect(parseCsvRecords("")).toEqual({ error: expect.any(String) });
  });

  it("treats the first non-blank line as the header", () => {
    const res = parseCsvRecords(",,\nname\nAnand");
    // The header is on line 2 here, so the first row is on line 3.
    expect("records" in res && res.records).toEqual([{ cells: { name: "Anand" }, line: 3 }]);
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
        line: 2,
        problem:
          'Row has 4 cells but the header has 3 — put values that contain commas in double quotes (past the last column: "SBIN0001234")',
      },
      { cells: { a: "4", b: "5", c: "6" }, line: 3 },
    ]);
  });

  it("numbers each record by the line it starts on, whatever blank or multi-line rows lie between", () => {
    const text = [
      "client_name,notes",
      "A,", // line 2
      "", // 3: blank
      ",", // 4: all commas
      'B,"one', // 5: opens a note that
      'two"', // 6: ends here
      "", // 7: blank
      "C,x", // 8
    ].join("\n");
    const res = parseCsvRecords(text);
    expect("records" in res && res.records.map((r) => [r.line, r.cells.client_name])).toEqual([
      [2, "A"],
      [5, "B"],
      [8, "C"],
    ]);
  });

  it("gives a row that is flagged its line too", () => {
    const res = parseCsvRecords("a,b\n\n1,2,3");
    expect("records" in res && res.records[0]).toMatchObject({
      line: 3,
      problem: expect.any(String),
    });
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

describe("decodeCsvBytes", () => {
  const bytes = (...parts: (string | number[])[]) =>
    Uint8Array.from(
      parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part, "utf8")] : part)),
    );

  it("reads UTF-8 as it is, accents, dashes and a byte-order mark included", () => {
    const utf8 = new TextEncoder().encode("\uFEFFclient_name,notes\nRavi – K,café ₹");
    expect(decodeCsvBytes(utf8)).toEqual({
      text: "client_name,notes\nRavi – K,café ₹",
      windows1252: false,
    });
  });

  it("takes plain ASCII for UTF-8", () => {
    expect(decodeCsvBytes(bytes("a,b\n1,2"))).toEqual({ text: "a,b\n1,2", windows1252: false });
  });

  it("falls back to Windows-1252 for a file that is not valid UTF-8, where UTF-8 would damage it", () => {
    // Excel's default CSV save: 0x96 is an en dash, 0xE9 an e acute, 0x92 a curly apostrophe.
    const file = bytes("Ravi ", [0x96], " K,caf", [0xe9], ",Anand", [0x92], "s");
    expect(decodeCsvBytes(file)).toEqual({ text: "Ravi – K,café,Anand’s", windows1252: true });
    // What reading it as UTF-8, leniently, would have stored instead.
    expect(new TextDecoder().decode(file)).toContain("\uFFFD");
  });

  it("never produces a replacement character from a Windows-1252 file", () => {
    const { text, windows1252 } = decodeCsvBytes(Uint8Array.from([0x61, 0x81, 0x8d, 0xff, 0x62]));
    expect(windows1252).toBe(true);
    expect(text).not.toContain("\uFFFD");
  });

  it("accepts an ArrayBuffer, which is what File.arrayBuffer() gives", () => {
    const file = bytes("caf", [0xe9]);
    expect(decodeCsvBytes(file.buffer as ArrayBuffer)).toEqual({ text: "café", windows1252: true });
  });

  it("falls back for a UTF-8 file with one stray byte rather than lose the other characters", () => {
    expect(decodeCsvBytes(bytes("Ravi – K ", [0x96])).windows1252).toBe(true);
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
    // The third row has a newline in a cell, so the last one starts on line 5.
    expect(parseCsv(toCsv(rows))).toEqual({ rows, lines: [1, 2, 3, 5] });
  });
});
