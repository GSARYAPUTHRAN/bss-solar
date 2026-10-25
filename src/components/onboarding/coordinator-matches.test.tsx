// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CoordinatorMatch } from "@/lib/domain/coordinator-match";
import { CoordinatorMatches, describeRows } from "./coordinator-matches";

const RAVI = { id: "ravi", fullName: "Ravi Kumar", email: "ravi@bsssolar.in", role: "coordinator" as const };
const PRIYA = { id: "priya", fullName: "Priya Suresh", email: "priya@bsssolar.in", role: "coordinator" as const };
const UNNAMED = { id: "u", fullName: "sudheesh.k@bsssolar.in", email: "sudheesh.k@bsssolar.in", role: "coordinator" as const };

const match = (m: Partial<CoordinatorMatch> & Pick<CoordinatorMatch, "written">): CoordinatorMatch => ({
  account: null,
  problem: null,
  rows: [2],
  ...m,
});

describe("describeRows", () => {
  it("reads naturally for one, two and several rows", () => {
    expect(describeRows([5])).toBe("row 5");
    expect(describeRows([5, 8])).toBe("rows 5 and 8");
    expect(describeRows([2, 3, 9])).toBe("rows 2, 3 and 9");
  });

  it("counts the rest of a long list instead of printing it", () => {
    const rows = Array.from({ length: 30 }, (_, i) => i + 2);
    expect(describeRows(rows)).toBe("rows 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 and 18 more");
  });
});

describe("CoordinatorMatches", () => {
  it("renders nothing when no coordinator was written", () => {
    const { container } = render(<CoordinatorMatches matches={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the account a name became, with its e-mail and rows", () => {
    render(<CoordinatorMatches matches={[match({ written: "Ravi", account: RAVI, rows: [2, 7] })]} />);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent(/“Ravi” → .*Ravi Kumar \(ravi@bsssolar\.in\)/);
    expect(item).toHaveTextContent("rows 2 and 7");
    expect(screen.queryByText(/need.* fixing/i)).not.toBeInTheDocument();
  });

  it("says why a name is not an account, in its own words, and counts them", () => {
    render(
      <CoordinatorMatches
        matches={[
          match({
            written: "Abhijit",
            problem: "is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.in)?",
          }),
          match({ written: "OFFICE", problem: "is not an account — write the e-mail of the office account", rows: [4] }),
        ]}
      />,
    );
    expect(screen.getByText(/2 need fixing/i)).toBeVisible();
    const [first, second] = screen.getAllByRole("listitem");
    expect(first).toHaveTextContent(
      "“Abhijit” is not a coordinator or office account — did you mean Abhijith Nair (abhijith@bsssolar.in)?",
    );
    // Not by colour alone: the item says it needs fixing.
    expect(within(first).getByText(/needs fixing/i)).toBeInTheDocument();
    expect(second).toHaveTextContent("“OFFICE” is not an account");
  });

  it("lists blank cells with the default coordinator they fell back to", () => {
    render(<CoordinatorMatches matches={[match({ written: "", account: PRIYA, rows: [3, 5] })]} />);
    expect(screen.getByRole("listitem")).toHaveTextContent(
      /\(blank\) → .*Priya Suresh \(priya@bsssolar\.in\) \(default coordinator\)/,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("rows 3 and 5");
  });

  it("lists blank cells with no default as the reason rows fail", () => {
    render(
      <CoordinatorMatches
        matches={[match({ written: "", problem: "no default coordinator was chosen — these rows fail", rows: [6, 9] })]}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      /\(blank\) → .*no default chosen — these rows fail/,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("rows 6 and 9");
  });

  it("flags an account whose name is its e-mail, and says what can really be done", () => {
    render(<CoordinatorMatches matches={[match({ written: "Sudheesh", account: UNNAMED })]} />);
    const note = screen.getByText(/this account has no name/i);
    expect(note).toBeVisible();
    // The Team page has no rename: it can add a member (with a name), not edit one.
    expect(note).toHaveTextContent(/the team page cannot rename it/i);
    expect(note).toHaveTextContent(/team → add member/i);
    expect(note).toHaveTextContent(/ask whoever manages the database to set it/i);
    expect(note).not.toHaveTextContent(/set it on the team page/i);
  });

  it("does not flag an account that has a name", () => {
    render(<CoordinatorMatches matches={[match({ written: "Ravi", account: RAVI })]} />);
    expect(screen.queryByText(/has no name/i)).not.toBeInTheDocument();
  });
});
