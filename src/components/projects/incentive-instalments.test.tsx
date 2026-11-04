// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatCurrency, formatDate } from "@/lib/format";
import type { IncentiveInstalment } from "@/server/data/projects.repository";
import { IncentiveFigures, InstalmentList } from "./incentive-instalments";

const FIRST: IncentiveInstalment = {
  id: "pay-1",
  amount: 20000,
  paid_on: "2025-05-15",
  note: null,
  recorded_by: "admin-1",
  recorded_by_name: "BSS Admin",
};
const SECOND: IncentiveInstalment = {
  id: "pay-2",
  amount: 2360.5,
  paid_on: "2025-05-16",
  note: "Cheque 004211",
  recorded_by: null,
  recorded_by_name: null,
};

describe("IncentiveFigures", () => {
  it("states what is agreed, paid and still to pay, to the paisa", () => {
    render(<IncentiveFigures amount={25000} paid={22360.5} pending={2639.5} />);
    const agreed = screen.getByText("Agreed").nextElementSibling;
    const paid = screen.getByText("Paid").nextElementSibling;
    const pending = screen.getByText("Still to pay").nextElementSibling;
    expect(agreed).toHaveTextContent(formatCurrency(25000));
    expect(paid).toHaveTextContent(formatCurrency(22360.5));
    expect(pending).toHaveTextContent(formatCurrency(2639.5));
  });

  it("draws the eye to money still owed, not to a settled incentive", () => {
    const { rerender } = render(<IncentiveFigures amount={5000} paid={1000} pending={4000} />);
    expect(screen.getByText("Still to pay").nextElementSibling?.className).toContain("amber");
    rerender(<IncentiveFigures amount={5000} paid={5000} pending={0} />);
    expect(screen.getByText("Still to pay").nextElementSibling?.className).not.toContain("amber");
  });
});

describe("InstalmentList", () => {
  it("lists each instalment with its date, amount, note and who recorded it", () => {
    render(<InstalmentList label="Payments to Ravi Kumar" payments={[FIRST, SECOND]} />);
    const list = screen.getByRole("list", { name: "Payments to Ravi Kumar" });
    const [first, second] = within(list).getAllByRole("listitem");

    expect(first).toHaveTextContent(formatDate("2025-05-15"));
    expect(first).toHaveTextContent(formatCurrency(20000));
    expect(first).toHaveTextContent("Recorded by BSS Admin");
    expect(within(first).getByText(formatDate("2025-05-15"))).toHaveAttribute(
      "datetime",
      "2025-05-15",
    );

    expect(second).toHaveTextContent(formatCurrency(2360.5));
    expect(second).toHaveTextContent("Cheque 004211");
    // Nobody to name: nothing is said about a recorder.
    expect(second).not.toHaveTextContent("Recorded by");
  });

  it("keeps the order it is given (the repository sorts oldest first)", () => {
    render(<InstalmentList label="Payments" payments={[SECOND, FIRST]} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Cheque 004211");
    expect(rows[1]).toHaveTextContent(formatCurrency(20000));
  });

  it("adds the office's per-row controls only when asked", () => {
    const { rerender } = render(<InstalmentList label="Payments" payments={[FIRST]} />);
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <InstalmentList
        label="Payments"
        payments={[FIRST]}
        renderActions={(p) => <button type="button">Edit {p.id}</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit pay-1" })).toBeInTheDocument();
  });

  it("says so when nothing has been paid yet", () => {
    render(<InstalmentList label="Payments" payments={[]} />);
    expect(screen.getByText("No payments recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
