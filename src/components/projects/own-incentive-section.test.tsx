// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatCurrency, formatDate } from "@/lib/format";
import type { DetailIncentive } from "@/server/data/projects.repository";
import { OwnIncentiveSection } from "./own-incentive-section";

const PART_PAID: DetailIncentive = {
  amount: 6000,
  paid_on: null,
  payments: [
    { id: "a", amount: 2000, paid_on: "2026-09-01", note: null, recorded_by: "o", recorded_by_name: null },
    { id: "b", amount: 2000, paid_on: "2026-09-15", note: "Cheque 4411", recorded_by: "o", recorded_by_name: null },
  ],
  paid: 4000,
};

describe("OwnIncentiveSection", () => {
  it("shows what the office agreed, what has been paid, each payment and what is to come", () => {
    render(<OwnIncentiveSection incentive={PART_PAID} />);

    expect(screen.getByText("Your incentive payments")).toBeInTheDocument();
    expect(screen.getByText("Partly paid")).toBeInTheDocument();
    expect(screen.getByText("Agreed").nextElementSibling).toHaveTextContent(formatCurrency(6000));
    expect(screen.getByText("Paid").nextElementSibling).toHaveTextContent(formatCurrency(4000));
    expect(screen.getByText("Still to pay").nextElementSibling).toHaveTextContent(
      formatCurrency(2000),
    );

    const list = screen.getByRole("list", { name: "Payments to you" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(formatDate("2026-09-01"));
    expect(rows[1]).toHaveTextContent("Cheque 4411");
  });

  it("is read-only: no form, no button, no way to change anything", () => {
    render(<OwnIncentiveSection incentive={PART_PAID} />);
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("says plainly when the office has not set an incentive, instead of showing zeros", () => {
    render(<OwnIncentiveSection incentive={{ amount: null, paid_on: null, payments: [], paid: 0 }} />);
    expect(screen.getByText("The office has not set your incentive on this sale yet.")).toBeInTheDocument();
    expect(screen.queryByText("Agreed")).toBeNull();
    expect(screen.queryByText("Not set")).toBeNull();
  });

  it("copes with a missing incentive row altogether", () => {
    render(<OwnIncentiveSection incentive={null} />);
    expect(screen.getByText("The office has not set your incentive on this sale yet.")).toBeInTheDocument();
  });

  it("an incentive agreed but not yet paid says no payments yet", () => {
    render(
      <OwnIncentiveSection incentive={{ amount: 2500, paid_on: null, payments: [], paid: 0 }} />,
    );
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("No payments recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("Still to pay").nextElementSibling).toHaveTextContent(
      formatCurrency(2500),
    );
  });

  it("a settled incentive reads Paid with nothing still to pay", () => {
    render(
      <OwnIncentiveSection
        incentive={{
          amount: 4000,
          paid_on: "2026-09-15",
          payments: PART_PAID.payments,
          paid: 4000,
        }}
      />,
    );
    expect(screen.getByText("Paid", { selector: "span[data-slot=badge]" })).toBeInTheDocument();
    expect(screen.getByText("Still to pay").nextElementSibling).toHaveTextContent(formatCurrency(0));
  });
});
