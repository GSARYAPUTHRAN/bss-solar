// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoordinatorDirectory } from "@/lib/domain/coordinator-match";
import { planImport } from "@/lib/domain/import";
import {
  IMPORT_INITIAL,
  checkedState,
  summarizeImport,
  type ImportState,
} from "@/lib/domain/import-results";
import { BulkImportForm } from "./bulk-import-form";

vi.mock("@/app/(app)/onboarding/actions", () => ({ importProjects: vi.fn() }));

import { importProjects } from "@/app/(app)/onboarding/actions";

const action = vi.mocked(importProjects);

beforeAll(() => {
  // Radix measures the checkbox with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  action.mockResolvedValue(IMPORT_INITIAL);
});

const COORDINATOR = "10000000-0000-0000-0000-000000000001";
const OPTIONS = [{ value: COORDINATOR, label: "Rahul · Coordinator" }];

const RAHUL = { id: COORDINATOR, fullName: "Rahul Menon", email: "coord@bsssolar.test", role: "coordinator" as const };
const ABHIJITH = { id: "10000000-0000-0000-0000-000000000002", fullName: "Abhijith Nair", email: "abhijith@bsssolar.test", role: "coordinator" as const };
const UNNAMED = { id: "10000000-0000-0000-0000-000000000003", fullName: "sudheesh.k@bsssolar.test", email: "sudheesh.k@bsssolar.test", role: "coordinator" as const };
const DIRECTORY = new CoordinatorDirectory([RAHUL, ABHIJITH, UNNAMED]);

const CSV = [
  "client_name,plant_capacity,total_cost,order_date,coordinator",
  "Anand Kumar,3kW,195000,2025-01-10,Rahul",
  "Meera Nair,3kW,195000,2025-01-10,Abhijit",
  "Joseph Mathew,3kW,195000,2025-01-10,Sudheesh",
].join("\n");

function planned(csv = CSV) {
  const res = planImport(csv, { today: "2026-10-22", directory: DIRECTORY, defaultCoordinatorId: null });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function renderForm() {
  render(<BulkImportForm coordinators={OPTIONS} />);
  return userEvent.setup();
}

function setCsv(text: string) {
  fireEvent.change(screen.getByLabelText("CSV data"), { target: { value: text } });
}

/** The FormData the form handed to the action on its n-th call. */
function posted(call = 0): FormData {
  return action.mock.calls[call][1] as FormData;
}

describe("BulkImportForm — skip existing", () => {
  it("says only rows with a consumer number are protected, and what to re-upload", () => {
    renderForm();
    const skip = screen.getByRole("checkbox", {
      name: /skip rows whose consumer number already exists/i,
    });
    expect(skip).toBeChecked();
    expect(skip).toHaveAccessibleDescription(/rows without a consumer number are imported again/i);
    expect(skip).toHaveAccessibleDescription(/upload the failed-rows download/i);
    expect(skip).not.toHaveAccessibleDescription(/makes re-uploading safe/i);
  });
});

describe("BulkImportForm — the CSV box", () => {
  it("keeps one size however much is pasted: it scrolls instead of growing with its text", () => {
    renderForm();
    const box = screen.getByLabelText("CSV data");
    // The shared Textarea sizes itself to its content; this one must not, or
    // Check file, Import and the results sit thousands of pixels below a real sheet.
    expect(box).toHaveClass("field-sizing-fixed", "h-60", "overflow-y-auto", "resize-y");
    expect(box).not.toHaveClass("field-sizing-content");

    const before = box.className;
    setCsv(["client_name,plant_capacity,total_cost", ...Array.from({ length: 400 }, (_, i) => `C${i},3kW,1000`)].join("\n"));
    expect(box.className).toBe(before);
  });
});

describe("BulkImportForm — loading a file", () => {
  /** Choose a file with exactly these bytes, as the file picker would. */
  async function choose(user: ReturnType<typeof renderForm>, name: string, bytes: number[]) {
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File([Uint8Array.from(bytes)], name, { type: "text/csv" });
    await user.upload(input, file);
  }
  const ascii = (text: string) => [...new TextEncoder().encode(text)];
  const csvBox = () => screen.getByLabelText("CSV data") as HTMLTextAreaElement;

  it("reads a UTF-8 file as it is, with no notice", async () => {
    const user = renderForm();
    await choose(user, "sheet.csv", ascii("client_name,notes\nRavi – K,café ₹"));

    expect(await screen.findByText(/loaded sheet\.csv/i)).toBeVisible();
    expect(csvBox().value).toBe("client_name,notes\nRavi – K,café ₹");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reads a file that is not UTF-8 as Windows-1252, and says so", async () => {
    const user = renderForm();
    // Excel's default CSV save: 0x96 is an en dash, 0xE9 an e acute.
    await choose(user, "excel.csv", [...ascii("client_name,notes\nRavi "), 0x96, ...ascii(" K,caf"), 0xe9]);

    expect(await screen.findByText(/loaded excel\.csv/i)).toBeVisible();
    expect(csvBox().value).toBe("client_name,notes\nRavi – K,café");
    // UTF-8, read leniently, would have stored U+FFFD for each of those bytes.
    expect(csvBox().value).not.toContain("\uFFFD");
    expect(screen.getByRole("status")).toHaveTextContent(
      "This file was not UTF-8, so it was read as Windows-1252 — check names and notes with accents or dashes.",
    );
  });

  it("drops the notice when a UTF-8 file is loaded after it", async () => {
    const user = renderForm();
    await choose(user, "excel.csv", [...ascii("a,b\n1,caf"), 0xe9]);
    expect(await screen.findByRole("status")).toBeVisible();

    await choose(user, "utf8.csv", ascii("a,b\n1,café"));
    expect(await screen.findByText(/loaded utf8\.csv/i)).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(csvBox().value).toBe("a,b\n1,café");
  });

  it("posts the text it decoded, not the bytes it could not read", async () => {
    const user = renderForm();
    const header = "client_name,plant_capacity,total_cost,coordinator";
    await choose(user, "excel.csv", [...ascii(`${header}\nRavi `), 0x96, ...ascii(" K,3kW,1,Rahul")]);
    await screen.findByText(/loaded excel\.csv/i);
    await user.click(screen.getByRole("button", { name: /check file/i }));
    expect(posted().get("csv")).toBe(`${header}\nRavi – K,3kW,1,Rahul`);
  });
});

describe("BulkImportForm — the default coordinator", () => {
  it("starts at No default, not at the signed-in admin", () => {
    renderForm();
    const select = screen.getByRole("combobox", { name: /default coordinator for blank cells/i });
    expect(select).toHaveTextContent("No default — rows with a blank coordinator fail");
    expect(select).not.toHaveTextContent("Rahul");
  });

  it("says what a blank cell means, and that such rows cannot carry an incentive", () => {
    renderForm();
    expect(screen.getByText(/only used for rows whose coordinator cell is blank/i)).toBeVisible();
    expect(screen.getByText(/they cannot carry an incentive/i)).toBeVisible();
  });

  it("posts 'none' until someone is chosen", async () => {
    const user = renderForm();
    setCsv(CSV);
    await user.click(screen.getByRole("button", { name: /check file/i }));
    expect(posted().get("default_coordinator_id")).toBe("none");
  });
});

describe("BulkImportForm — which button was pressed", () => {
  it("Check file posts intent=check, with the CSV and the other fields", async () => {
    const user = renderForm();
    setCsv(CSV);
    await user.click(screen.getByRole("button", { name: /check file/i }));

    expect(action).toHaveBeenCalledTimes(1);
    const data = posted();
    expect(data.get("intent")).toBe("check");
    expect(data.get("csv")).toBe(CSV);
    expect(data.get("skip_existing")).toBe("true");
  });

  it("Import projects posts intent=import", async () => {
    const user = renderForm();
    setCsv(CSV);
    await user.click(screen.getByRole("button", { name: /^import projects$/i }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(posted().get("intent")).toBe("import");
  });

  it("does not remember the last button: each submit says its own intent", async () => {
    const user = renderForm();
    setCsv(CSV);
    await user.click(screen.getByRole("button", { name: /check file/i }));
    await user.click(screen.getByRole("button", { name: /^import projects$/i }));
    expect(posted(0).get("intent")).toBe("check");
    expect(posted(1).get("intent")).toBe("import");
  });

  it("sends an empty intent — never a default one — when nothing says which button submitted", () => {
    renderForm();
    setCsv(CSV);
    // A submit that did not come from a button (script, odd browser).
    fireEvent.submit(screen.getByLabelText("CSV data").closest("form") as HTMLFormElement);
    expect(action).toHaveBeenCalledTimes(1);
    expect(posted().get("intent")).toBe("");
  });

  it("keeps Check file first, so that Enter in a field checks rather than imports", () => {
    renderForm();
    const submits = screen
      .getAllByRole("button")
      .filter((b) => (b as HTMLButtonElement).type === "submit");
    expect(submits.map((b) => (b as HTMLButtonElement).value)).toEqual(["check", "import"]);
  });

  // React runs actions one after another, so a promise that never settles would hold
  // back every later test: settle it before the test ends.
  function slowAction() {
    let finish: (state: ImportState) => void = () => {};
    action.mockReturnValue(new Promise<ImportState>((resolve) => (finish = resolve)));
    return () => finish(IMPORT_INITIAL);
  }

  it("labels the button that was pressed while it works, and disables both", async () => {
    const finish = slowAction();
    const user = renderForm();
    setCsv(CSV);
    await user.click(screen.getByRole("button", { name: /check file/i }));

    expect(await screen.findByRole("button", { name: /checking…/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^import projects$/i })).toBeDisabled();

    finish();
    expect(await screen.findByRole("button", { name: /^check file$/i })).toBeEnabled();
  });

  it("says Importing… on the Import button", async () => {
    const finish = slowAction();
    const user = renderForm();
    setCsv(CSV);
    await user.click(screen.getByRole("button", { name: /^import projects$/i }));

    expect(await screen.findByRole("button", { name: /importing…/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^check file$/i })).toBeDisabled();

    finish();
    expect(await screen.findByRole("button", { name: /^import projects$/i })).toBeEnabled();
  });
});

describe("BulkImportForm — a check's results", () => {
  async function checked(csv = CSV) {
    action.mockResolvedValue(checkedState(planned(csv)));
    const user = renderForm();
    setCsv(csv);
    await user.click(screen.getByRole("button", { name: /check file/i }));
    await screen.findByRole("heading", { name: /nothing was imported/i });
    return user;
  }

  it("counts Ready and Failed rows — there is nothing imported or skipped to count", async () => {
    await checked();
    const filter = screen.getByRole("group", { name: /filter results/i });
    expect(within(filter).getAllByRole("button").map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "2 ready",
      "1 failed",
    ]);
    expect(screen.getByText(/nothing has been written/i)).toBeVisible();
  });

  it("explains that ready rows with a known consumer number are skipped at import", async () => {
    await checked();
    expect(
      screen.getByText(/ready rows will be imported — except those whose consumer number is already in the system/i),
    ).toBeVisible();
  });

  it("says a row repeating an earlier row's number in the file is skipped too, and which rows", async () => {
    const csv = [
      "client_name,plant_capacity,total_cost,order_date,coordinator,consumer_number",
      "Anand Kumar,3kW,195000,2025-01-10,Rahul,NA",
      "Meera Nair,3kW,195000,2025-01-10,Rahul,NA",
    ].join("\n");
    await checked(csv);
    expect(
      screen.getByText(/already in the system or repeated earlier in this file, which are skipped/i),
    ).toBeVisible();
    const warnings = screen.getByRole("region", { name: /worth a look/i });
    expect(
      within(warnings).getByText(/^Rows 2 and 3 share consumer number NA — only the first \(row 2\)/),
    ).toBeVisible();
  });

  it("lists the rows whose text was damaged in reading", async () => {
    await checked(
      "client_name,plant_capacity,total_cost,order_date,coordinator\nRavi \uFFFD K,3kW,195000,2025-01-10,Rahul",
    );
    const warnings = screen.getByRole("region", { name: /worth a look/i });
    expect(within(warnings).getByText(/^Row 2 contains the replacement character/)).toBeVisible();
  });

  it("shows who each coordinator name became, problems first, with the suggestion", async () => {
    await checked();
    const panel = screen.getByRole("region", { name: /coordinator matches/i });
    expect(within(panel).getByText(/1 needs fixing/i)).toBeVisible();
    const items = within(panel).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(
      "“Abhijit” is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.test)?",
    );
    expect(items[0]).toHaveTextContent("row 3");
    expect(items[1]).toHaveTextContent(/“Rahul” → .*Rahul Menon \(coord@bsssolar\.test\)/);
    expect(items[1]).toHaveTextContent("row 2");
  });

  it("flags an account whose name is its e-mail", async () => {
    await checked();
    const panel = screen.getByRole("region", { name: /coordinator matches/i });
    const note = within(panel).getByText(/this account has no name/i);
    expect(note).toBeVisible();
    expect(note).not.toHaveTextContent(/set it on the team page/i);
  });

  it("lists the file's warnings above the rows", async () => {
    await checked();
    const warnings = screen.getByRole("region", { name: /worth a look/i });
    expect(within(warnings).getByText(/rows have no consumer_number/i)).toBeVisible();
  });

  it("puts each row's warning under its message", async () => {
    await checked("client_name,plant_capacity,total_cost,coordinator\nAnand Kumar,3kW,195000,Rahul");
    expect(screen.getByText(/order_date is blank — today \(.*\) will be used/i)).toBeVisible();
    expect(screen.getByText(/^Ready · At Site Feasibility Survey · Rahul Menon$/)).toBeVisible();
  });

  it("offers only the failed rows to download", async () => {
    await checked();
    expect(screen.getByRole("button", { name: /download failed rows/i })).toBeVisible();
  });

  it("shows a file-level problem from a check as the error", async () => {
    action.mockResolvedValue({ ...IMPORT_INITIAL, ran: true, mode: "check", error: "No data rows found below the header." });
    const user = renderForm();
    setCsv("client_name,plant_capacity,total_cost,coordinator");
    await user.click(screen.getByRole("button", { name: /check file/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No data rows found below the header.");
  });
});

describe("BulkImportForm — an import's results", () => {
  it("counts Imported, Skipped and Failed, with the coordinators named in each message", async () => {
    const plan = planned();
    action.mockResolvedValue(
      summarizeImport(
        plan,
        new Map([[2, { row_no: 2, status: "imported", message: null }]]),
      ),
    );
    const user = renderForm();
    setCsv(CSV);
    await user.click(screen.getByRole("button", { name: /^import projects$/i }));

    const filter = await screen.findByRole("group", { name: /filter results/i });
    expect(within(filter).getAllByRole("button").map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "1 imported",
      "0 skipped",
      "2 failed",
    ]);
    expect(screen.getByText("Imported at Site Feasibility Survey · Rahul Menon")).toBeVisible();
    expect(screen.queryByText(/nothing has been written/i)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /coordinator matches/i })).toBeVisible();
  });

  it("filters the rows by status", async () => {
    action.mockResolvedValue(
      summarizeImport(planned(), new Map([[2, { row_no: 2, status: "imported", message: null }]])),
    );
    const user = renderForm();
    setCsv(CSV);
    await user.click(screen.getByRole("button", { name: /^import projects$/i }));
    await user.click(await screen.findByRole("button", { name: /2 failed/i }));

    expect(screen.queryByText("Anand Kumar")).not.toBeInTheDocument();
    expect(screen.getByText("Meera Nair")).toBeVisible();
  });
});
