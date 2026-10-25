import { describe, it, expect } from "vitest";
import type { UserRole } from "@/lib/types";
import {
  CoordinatorDirectory,
  analyzeCoordinatorCell,
  describeReferenceProblem,
  givenName,
  matchingName,
  normalizePersonName,
  otherNameWords,
  resolveCoordinatorCell,
  splitCoordinatorCell,
  type DirectoryAccount,
} from "./coordinator-match";

let seq = 0;
function account(fullName: string, email: string | null, role: UserRole = "coordinator") {
  seq += 1;
  return { id: `id-${seq}-${fullName.split(" ")[0].toLowerCase()}`, fullName, email, role };
}

// Staff only: the first names are the ones the real sheet uses, the rest is made up.
const SUDHEESH = account("Sudheesh Pillai", "sudheesh@bsssolar.in");
const RAVI = account("Ravi Kumar", "ravi@bsssolar.in");
const ABHIJITH = account("Abhijith Nair", "abhijith@bsssolar.in");
const MANOHAR = account("Manohar Das", "manohar@bsssolar.in");
const NISHANTH = account("Nishanth Raj", "nishanth@bsssolar.in");
const ADMIN = account("BSS Admin", "admin@bsssolar.in", "admin");
const ANIL = account("Anil Kumar", "anil@bsssolar.in", "service_engineer");

const TEAM = new CoordinatorDirectory([SUDHEESH, RAVI, ABHIJITH, MANOHAR, NISHANTH, ADMIN, ANIL]);

const COLUMN = "coordinator";

/** The people a cell names (full names), or its problems — in one string. */
function read(raw: string, dir = TEAM): string[] {
  const res = resolveCoordinatorCell(raw, dir, COLUMN);
  if (!res.ok) throw new Error(res.error);
  if (res.data === null) throw new Error("blank");
  return res.data.names;
}

function problem(raw: string, dir = TEAM, column = COLUMN): string {
  const res = resolveCoordinatorCell(raw, dir, column);
  if (res.ok) throw new Error(`expected a problem, got ${JSON.stringify(res.data)}`);
  return res.error;
}

describe("normalizePersonName", () => {
  it("lower-cases, turns . _ - into spaces and collapses them", () => {
    expect(normalizePersonName("  K.  Sudheesh ")).toBe("k sudheesh");
    expect(normalizePersonName("sudheesh.k_nair-x")).toBe("sudheesh k nair x");
    expect(normalizePersonName("ＲＡＶＩ")).toBe("ravi");
  });
});

describe("givenName / otherNameWords", () => {
  it("skips initials: the given name is the first word of two letters or more", () => {
    expect(givenName("K. Sudheesh")).toBe("sudheesh");
    expect(givenName("Ravi Kumar")).toBe("ravi");
    expect(givenName("S. K.")).toBeNull();
    expect(givenName("")).toBeNull();
  });

  it("lists every other word in order, initials before the given name included", () => {
    expect(otherNameWords("K. Sudheesh Nair")).toEqual(["k", "nair"]);
    expect(otherNameWords("Ravi")).toEqual([]);
  });
});

describe("matchingName", () => {
  it("is the normalised full name", () => {
    expect(matchingName(RAVI)).toEqual({ name: "ravi kumar", nameIsEmail: false });
  });

  it("uses the part before the @ when the full name is really an e-mail", () => {
    const unnamed = account("sudheesh.k@bsssolar.in", "sudheesh.k@bsssolar.in");
    expect(matchingName(unnamed)).toEqual({ name: "sudheesh k", nameIsEmail: true });
  });
});

describe("CoordinatorDirectory", () => {
  it("finds an account by e-mail, ignoring case and space", () => {
    expect(TEAM.byEmail(" Ravi@BSSSolar.in ")).toBe(RAVI);
    expect(TEAM.byEmail("nobody@bsssolar.in")).toBeNull();
  });

  it("finds accounts of any role by full name", () => {
    expect(TEAM.byFullName("ravi KUMAR")).toEqual([RAVI]);
    expect(TEAM.byFullName("Anil Kumar")).toEqual([ANIL]);
    expect(TEAM.byFullName("")).toEqual([]);
  });

  it("finds owner accounts by given name — never a service engineer", () => {
    expect(TEAM.byGivenName("Anil")).toEqual([]);
    expect(TEAM.engineersNamed("Anil")).toEqual([ANIL]);
    expect(TEAM.byGivenName("Manohar")).toEqual([MANOHAR]);
  });

  it("points at the first admin as the office account", () => {
    expect(TEAM.officeAccount()).toBe(ADMIN);
    expect(new CoordinatorDirectory([RAVI]).officeAccount()).toBeNull();
    const superadmin = account("Owner", "owner@bsssolar.in", "superadmin");
    expect(new CoordinatorDirectory([RAVI, superadmin]).officeAccount()).toBe(superadmin);
  });

  it("labels an account with its e-mail so two of one name can be told apart", () => {
    expect(CoordinatorDirectory.label(RAVI)).toBe("Ravi Kumar (ravi@bsssolar.in)");
    expect(CoordinatorDirectory.label(account("Ravi Kumar", null))).toBe("Ravi Kumar");
    const unnamed = account("x@y.in", "x@y.in");
    expect(CoordinatorDirectory.label(unnamed)).toBe("x@y.in");
  });
});

describe("splitCoordinatorCell", () => {
  it.each([
    ["Ravi, Abhijith", ["Ravi", "Abhijith"]],
    ["Ravi; Abhijith", ["Ravi", "Abhijith"]],
    ["Ravi / Abhijith", ["Ravi", "Abhijith"]],
    ["Ravi & Abhijith", ["Ravi", "Abhijith"]],
    ["Ravi and Abhijith", ["Ravi", "Abhijith"]],
    ["Ravi AND Abhijith", ["Ravi", "Abhijith"]],
    ["Ravi,Abhijith;Manohar", ["Ravi", "Abhijith", "Manohar"]],
  ])("splits %j", (raw, references) => {
    expect(splitCoordinatorCell(raw)).toEqual({ references, asides: [], problems: [] });
  });

  it("does not split a plus — an e-mail may contain it", () => {
    expect(splitCoordinatorCell("Abhijith+Ravi").references).toEqual(["Abhijith+Ravi"]);
    expect(splitCoordinatorCell("ravi+bss@x.in").references).toEqual(["ravi+bss@x.in"]);
  });

  it("never splits inside a name that merely contains 'and'", () => {
    expect(splitCoordinatorCell("Anand").references).toEqual(["Anand"]);
    expect(splitCoordinatorCell("Chandran").references).toEqual(["Chandran"]);
    expect(splitCoordinatorCell("Anand Chandran").references).toEqual(["Anand Chandran"]);
    expect(splitCoordinatorCell("Anand and Chandran").references).toEqual(["Anand", "Chandran"]);
  });

  it("takes bracketed remarks out of the names", () => {
    expect(splitCoordinatorCell("sudheesh(sheeja)")).toEqual({
      references: ["sudheesh"],
      asides: ["sheeja"],
      problems: [],
    });
    expect(splitCoordinatorCell("Ravi (new joiner) & Abhijith (part time)")).toEqual({
      references: ["Ravi", "Abhijith"],
      asides: ["new joiner", "part time"],
      problems: [],
    });
  });

  it("reports an unclosed bracket", () => {
    expect(splitCoordinatorCell("sudheesh(sheeja")).toEqual({
      references: [],
      asides: [],
      problems: ['coordinator "sudheesh(sheeja" has an unclosed bracket'],
    });
    expect(splitCoordinatorCell("sudheesh)", "coordinator_email").problems).toEqual([
      'coordinator_email "sudheesh)" has an unclosed bracket',
    ]);
  });

  it("reports an empty name between separators", () => {
    expect(splitCoordinatorCell("Ravi,, Abhijith").problems).toEqual([
      'coordinator "Ravi,, Abhijith" has an empty name — remove the extra separator',
    ]);
    expect(splitCoordinatorCell("Ravi &").problems).toHaveLength(1);
  });
});

describe("resolveCoordinatorCell — names", () => {
  it("is blank (null) for an empty cell, so the default coordinator can apply", () => {
    expect(resolveCoordinatorCell("", TEAM, COLUMN)).toEqual({ ok: true, data: null });
    expect(resolveCoordinatorCell("   ", TEAM, COLUMN)).toEqual({ ok: true, data: null });
    expect(resolveCoordinatorCell(undefined, TEAM, COLUMN)).toEqual({ ok: true, data: null });
  });

  it("resolves a first name that only one coordinator has", () => {
    expect(resolveCoordinatorCell("sudheesh", TEAM, COLUMN)).toEqual({
      ok: true,
      data: { ids: [SUDHEESH.id], names: ["Sudheesh Pillai"], asides: [] },
    });
    expect(read("Nishanth")).toEqual(["Nishanth Raj"]);
    expect(read("Manohar")).toEqual(["Manohar Das"]);
  });

  it("resolves a full name, in any case", () => {
    expect(read("ravi KUMAR")).toEqual(["Ravi Kumar"]);
  });

  it("keeps the order written and one id per person", () => {
    const res = resolveCoordinatorCell("Abhijith+Ravi", TEAM, COLUMN);
    expect(res).toEqual({
      ok: true,
      data: { ids: [ABHIJITH.id, RAVI.id], names: ["Abhijith Nair", "Ravi Kumar"], asides: [] },
    });
    expect(read("Ravi + Abhijith")).toEqual(["Ravi Kumar", "Abhijith Nair"]);
  });

  it.each(["Ravi, Abhijith", "Ravi; Abhijith", "Ravi / Abhijith", "Ravi & Abhijith", "Ravi and Abhijith"])(
    "reads %j as two people",
    (raw) => {
      expect(read(raw)).toEqual(["Ravi Kumar", "Abhijith Nair"]);
    },
  );

  it("keeps a remark in brackets out of the names and hands it back", () => {
    const res = resolveCoordinatorCell("sudheesh(sheeja)", TEAM, COLUMN);
    expect(res).toEqual({
      ok: true,
      data: { ids: [SUDHEESH.id], names: ["Sudheesh Pillai"], asides: ["sheeja"] },
    });
  });

  it("refuses a cell that is only a remark", () => {
    expect(problem("(sheeja)")).toBe('coordinator "(sheeja)" has no name outside the brackets');
  });

  it("reports an unclosed bracket and an empty name", () => {
    expect(problem("sudheesh(sheeja")).toBe('coordinator "sudheesh(sheeja" has an unclosed bracket');
    expect(problem("Ravi+")).toBe('coordinator "Ravi+" has an empty name — remove the extra "+"');
    expect(problem("+Ravi")).toBe('coordinator "+Ravi" has an empty name — remove the extra "+"');
  });

  it("uses the header the sheet used in every message", () => {
    expect(problem("Abhijit", TEAM, "coordinator_email")).toMatch(/^coordinator_email "Abhijit" /);
  });
});

describe("resolveCoordinatorCell — never a silent fuzzy match", () => {
  it('suggests "Abhijith" for "Abhijit" and does not resolve it', () => {
    expect(TEAM.suggestions("Abhijit")).toEqual([ABHIJITH]);
    expect(problem("Abhijit")).toBe(
      'coordinator "Abhijit" is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.in)?',
    );
  });

  it("reports the sheet's Ravi+Abhijit with the suggestion, and still names who Ravi is", () => {
    const analysis = analyzeCoordinatorCell("Ravi+Abhijit", TEAM, COLUMN);
    expect(analysis.value).toBeNull();
    expect(analysis.references.map((r) => [r.written, r.account?.fullName ?? null])).toEqual([
      ["Ravi", "Ravi Kumar"],
      ["Abhijit", null],
    ]);
    expect(analysis.problems).toEqual([
      'coordinator "Abhijit" is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.in)?',
    ]);
  });

  it("says to check the spelling when nothing is close", () => {
    expect(problem("Zubair")).toBe(
      'coordinator "Zubair" is not a coordinator or office account — check the spelling, or add the account on the Team page first',
    );
  });

  it("does not guess from a one- or two-letter word", () => {
    expect(TEAM.suggestions("Al")).toEqual([]);
    expect(TEAM.suggestions("")).toEqual([]);
  });

  it("offers a start of a name as a suggestion, still not a match", () => {
    expect(TEAM.suggestions("Abhi")).toEqual([ABHIJITH]);
    expect(problem("Abhi")).toMatch(/did you mean Abhijith Nair/);
  });

  it("offers at most three suggestions, the same first name first", () => {
    const many = new CoordinatorDirectory([
      account("Ravi Kumar", "ravi.k@x.in"),
      account("Ravi Shankar", "ravi.s@x.in"),
      account("Ravi Menon", "ravi.m@x.in"),
      account("Ravindra Das", "ravindra@x.in"),
    ]);
    const near = many.suggestions("Ravi Pillai");
    expect(near).toHaveLength(3);
    expect(near.every((a) => a.fullName.startsWith("Ravi "))).toBe(true);
  });

  it("never suggests a service engineer", () => {
    expect(TEAM.suggestions("Anill")).toEqual([]);
  });
});

describe("resolveCoordinatorCell — the first-name rule for longer references (D24)", () => {
  const KRISHNAN = account("Ravi Krishnan", "ravi.krishnan@bsssolar.in");
  const KUMAR_ONLY = new CoordinatorDirectory([RAVI, ABHIJITH]);
  const TWO_RAVIS = new CoordinatorDirectory([RAVI, KRISHNAN, ABHIJITH]);
  const K_SUDHEESH = account("K. Sudheesh", "sudheesh@bsssolar.in");
  const INITIAL_FIRST = new CoordinatorDirectory([K_SUDHEESH, RAVI]);

  it("lets a trailing initial or a start of the surname follow the first name", () => {
    expect(read("Ravi K", KUMAR_ONLY)).toEqual(["Ravi Kumar"]);
    expect(read("Ravi K.", KUMAR_ONLY)).toEqual(["Ravi Kumar"]);
    expect(read("Ravi Kum", KUMAR_ONLY)).toEqual(["Ravi Kumar"]);
  });

  it("skips an initial before the given name, on either side", () => {
    expect(read("Sudheesh K", INITIAL_FIRST)).toEqual(["K. Sudheesh"]);
    expect(read("sudheesh", INITIAL_FIRST)).toEqual(["K. Sudheesh"]);
    expect(read("K Sudheesh", INITIAL_FIRST)).toEqual(["K. Sudheesh"]);
  });

  it("never turns a different surname into a match", () => {
    expect(problem("Ravi Shankar", KUMAR_ONLY)).toBe(
      'coordinator "Ravi Shankar" is not a coordinator or office account — did you mean Ravi Kumar (ravi@bsssolar.in)?',
    );
    expect(KUMAR_ONLY.byGivenName("Ravi Shankar")).toEqual([]);
  });

  it("does not match a reference with more words than the account has", () => {
    expect(problem("Ravi K Nair", KUMAR_ONLY)).toMatch(/is not a coordinator or office account/);
  });

  it("is ambiguous when two accounts fit, naming both with their e-mails", () => {
    expect(problem("Ravi K", TWO_RAVIS)).toBe(
      'coordinator "Ravi K" matches more than one account: Ravi Krishnan (ravi.krishnan@bsssolar.in), Ravi Kumar (ravi@bsssolar.in) — write the full name or the e-mail',
    );
    expect(problem("Ravi", TWO_RAVIS)).toMatch(/matches more than one account/);
  });

  it("prefers an exact full name over the first-name rule", () => {
    const ravi = account("Ravi", "plain.ravi@bsssolar.in");
    const both = new CoordinatorDirectory([ravi, RAVI]);
    expect(read("Ravi", both)).toEqual(["Ravi"]);
    expect(read("Ravi Kumar", both)).toEqual(["Ravi Kumar"]);
  });

  it("says so when two accounts have exactly the same name", () => {
    const twin = account("Ravi Kumar", "rk@bsssolar.in");
    expect(problem("Ravi Kumar", new CoordinatorDirectory([RAVI, twin]))).toBe(
      'coordinator "Ravi Kumar" matches 2 accounts with that name: ravi@bsssolar.in, rk@bsssolar.in — write the e-mail',
    );
  });
});

describe("resolveCoordinatorCell — e-mails", () => {
  it("resolves an e-mail exactly, ignoring case", () => {
    expect(read("Ravi@BSSSolar.in")).toEqual(["Ravi Kumar"]);
    expect(read("admin@bsssolar.in")).toEqual(["BSS Admin"]);
  });

  it("takes a plus-addressed e-mail whole when an account has it", () => {
    const plus = account("Ravi Plus", "ravi+bss@bsssolar.in");
    const dir = new CoordinatorDirectory([RAVI, plus, ABHIJITH]);
    expect(read("ravi+bss@bsssolar.in", dir)).toEqual(["Ravi Plus"]);
  });

  it("reads e-mails and names joined by + as several people", () => {
    expect(read("ravi@bsssolar.in+abhijith@bsssolar.in")).toEqual(["Ravi Kumar", "Abhijith Nair"]);
    expect(read("Ravi+abhijith@bsssolar.in")).toEqual(["Ravi Kumar", "Abhijith Nair"]);
    expect(read("ravi@bsssolar.in & Manohar")).toEqual(["Ravi Kumar", "Manohar Das"]);
  });

  it("reports the whole piece once, with each failing part's own suggestion", () => {
    expect(problem("ravi@bsssolar.in+abhijit@bsssolar.in")).toBe(
      'coordinator "ravi@bsssolar.in+abhijit@bsssolar.in" — no account has the e-mail ravi@bsssolar.in+abhijit@bsssolar.in, and as two people: "abhijit@bsssolar.in" is not an account — did you mean abhijith@bsssolar.in?',
    );
  });

  it("reports an unknown e-mail, suggesting a near one or the Team page", () => {
    expect(problem("abhijit@bsssolar.in")).toBe(
      'coordinator "abhijit@bsssolar.in" is not an account — did you mean abhijith@bsssolar.in?',
    );
    expect(problem("zubair@elsewhere.com")).toBe(
      'coordinator "zubair@elsewhere.com" is not an account — check the e-mail, or add the account on the Team page first',
    );
  });

  it("refuses an engineer's e-mail", () => {
    expect(problem("anil@bsssolar.in")).toBe(
      'coordinator "anil@bsssolar.in" is Anil Kumar, a service engineer — a sale belongs to coordinator or office accounts',
    );
  });
});

describe("resolveCoordinatorCell — accounts whose name is their e-mail", () => {
  const unnamed = account("sudheesh.k@bsssolar.in", "sudheesh.k@bsssolar.in");
  const dir = new CoordinatorDirectory([unnamed, RAVI]);

  it("matches by the part before the @, and the panel can tell", () => {
    expect(read("Sudheesh", dir)).toEqual(["sudheesh.k@bsssolar.in"]);
    expect(read("Sudheesh K", dir)).toEqual(["sudheesh.k@bsssolar.in"]);
    const analysis = analyzeCoordinatorCell("Sudheesh", dir, COLUMN);
    const found = analysis.references[0].account as DirectoryAccount;
    expect(matchingName(found).nameIsEmail).toBe(true);
  });
});

describe("resolveCoordinatorCell — engineers and the office", () => {
  it("says a service engineer cannot own a sale", () => {
    expect(problem("Anil")).toBe(
      'coordinator "Anil" is Anil Kumar, a service engineer — a sale belongs to coordinator or office accounts',
    );
    expect(problem("Anil Kumar")).toMatch(/a service engineer/);
  });

  it("resolves a first name to the coordinator when an engineer shares it", () => {
    const dir = new CoordinatorDirectory([ANIL, account("Anil Menon", "anil.m@bsssolar.in")]);
    expect(read("Anil", dir)).toEqual(["Anil Menon"]);
  });

  it("asks for the office account's e-mail when the sheet says OFFICE", () => {
    expect(problem("OFFICE")).toBe(
      'coordinator "OFFICE" is not an account — write the e-mail of the office account that owns this sale (e.g. admin@bsssolar.in), or leave the cell blank to use the default coordinator',
    );
    expect(problem("office", new CoordinatorDirectory([RAVI]))).toBe(
      'coordinator "office" is not an account — write the e-mail of the office account that owns this sale, or leave the cell blank to use the default coordinator',
    );
  });

  it("lets an account literally named Office win over the hint", () => {
    const office = account("Office", "office@bsssolar.in", "admin");
    expect(read("OFFICE", new CoordinatorDirectory([office, RAVI]))).toEqual(["Office"]);
  });
});

describe("resolveCoordinatorCell — the whole team", () => {
  it("refuses the same person twice, by name and e-mail alike", () => {
    expect(problem("Ravi + Ravi")).toBe("coordinator names Ravi Kumar twice");
    expect(problem("Ravi & ravi@bsssolar.in")).toBe("coordinator names Ravi Kumar twice");
  });

  it("allows five people and refuses six", () => {
    const five = "Ravi, Abhijith, Sudheesh, Manohar, Nishanth";
    expect(read(five)).toHaveLength(5);
    expect(problem(`${five}, admin@bsssolar.in`)).toBe(
      "coordinator lists 6 people — a sale can have at most 5",
    );
  });

  it("joins every problem of the cell", () => {
    expect(problem("Abhijit & Zubair")).toMatch(/Abhijit.*did you mean.*; coordinator "Zubair"/);
  });
});

describe("the sheet's own cells", () => {
  // Every distinct coordinator cell of the corrected sheet, against a team that has its people.
  it.each([
    ["sudheesh", ["Sudheesh Pillai"]],
    ["Sudheesh", ["Sudheesh Pillai"]],
    ["Ravi + Abhijith", ["Ravi Kumar", "Abhijith Nair"]],
    ["Abhijith+Ravi", ["Abhijith Nair", "Ravi Kumar"]],
    ["Manohar", ["Manohar Das"]],
    ["Nishanth", ["Nishanth Raj"]],
    ["sudheesh(sheeja)", ["Sudheesh Pillai"]],
    ["admin@bsssolar.in", ["BSS Admin"]],
  ])("resolves %j", (raw, names) => {
    expect(read(raw)).toEqual(names);
  });

  it("flags the cells that are not accounts", () => {
    expect(problem("Ravi+Abhijit")).toMatch(/"Abhijit".*did you mean Abhijith Nair/);
    expect(problem("OFFICE")).toMatch(/is not an account/);
  });
});

describe("analyzeCoordinatorCell", () => {
  it("lists a cell it cannot read as one thing the sheet wrote, with why", () => {
    const unclosed = analyzeCoordinatorCell("sudheesh(sheeja", TEAM, COLUMN);
    expect(unclosed.blank).toBe(false);
    expect(unclosed.value).toBeNull();
    expect(unclosed.references).toEqual([
      { written: "sudheesh(sheeja", account: null, problem: "has an unclosed bracket" },
    ]);
    expect(unclosed.problems).toEqual(['coordinator "sudheesh(sheeja" has an unclosed bracket']);

    expect(analyzeCoordinatorCell("(sheeja)", TEAM, COLUMN).references[0]).toMatchObject({
      written: "(sheeja)",
      problem: "has no name outside the brackets",
    });
    expect(analyzeCoordinatorCell("Ravi,, Abhijith", TEAM, COLUMN).references[0].problem).toBe(
      "has an empty name — remove the extra separator",
    );
  });

  it("says a blank cell is blank, with nothing to resolve", () => {
    expect(analyzeCoordinatorCell("  ", TEAM, COLUMN)).toEqual({
      blank: true,
      references: [],
      value: null,
      problems: [],
    });
  });

  it("returns the people only when every reference resolved", () => {
    expect(analyzeCoordinatorCell("Ravi & Abhijith", TEAM, COLUMN).value?.names).toEqual([
      "Ravi Kumar",
      "Abhijith Nair",
    ]);
    expect(analyzeCoordinatorCell("Ravi & Zubair", TEAM, COLUMN).value).toBeNull();
  });
});

describe("describeReferenceProblem", () => {
  it("builds the row's sentence from the column, what was written and the reason", () => {
    expect(
      describeReferenceProblem("coordinator", { written: "Zed", account: null, problem: "is nobody" }),
    ).toBe('coordinator "Zed" is nobody');
  });
});
