// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STAGE_LABELS } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";
import {
  CancellationBadge,
  PaymentBadge,
  PlanBadge,
  StageBadge,
} from "./status-badges";

const OWING = { total_cost: 200000, advance_amount: 50000, payments_total: 50000 };
const SETTLED = { total_cost: 200000, advance_amount: 50000, payments_total: 150000 };

describe("CancellationBadge", () => {
  it("labels a cancelled project", () => {
    render(<CancellationBadge cancellation="cancelled" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("labels a refunded project", () => {
    render(<CancellationBadge cancellation="refunded" />);
    expect(screen.getByText("Refunded")).toBeInTheDocument();
  });

  it.each([null, undefined])("renders nothing for a live project (%s)", (cancellation) => {
    const { container } = render(<CancellationBadge cancellation={cancellation} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PlanBadge", () => {
  it("marks a custom plan", () => {
    render(<PlanBadge plan="custom" />);
    expect(screen.getByText("Custom plan")).toBeInTheDocument();
  });

  it.each(["solar", null, undefined] as const)(
    "renders nothing for the usual solar plant (%s)",
    (plan) => {
      const { container } = render(<PlanBadge plan={plan} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});

describe("StageBadge", () => {
  it("names the stage, as before", () => {
    render(<StageBadge stage="panel_installation" />);
    expect(screen.getByText(STAGE_LABELS.panel_installation)).toBeInTheDocument();
  });

  it("names a solar plant's final stage Plant Commissioning", () => {
    render(<StageBadge stage="plant_commissioning" plan="solar" />);
    expect(screen.getByText(STAGE_LABELS.plant_commissioning)).toBeInTheDocument();
  });

  it("names a custom plan's only stage Handover", () => {
    render(<StageBadge stage="plant_commissioning" plan="custom" />);
    expect(screen.getByText("Handover")).toBeInTheDocument();
    expect(screen.queryByText(STAGE_LABELS.plant_commissioning)).toBeNull();
  });
});

describe("PaymentBadge", () => {
  it("is unchanged for a live project", () => {
    const { rerender } = render(<PaymentBadge source={OWING} isCompleted={false} />);
    expect(screen.getByText(`Balance ${formatCurrency(100000)}`)).toBeInTheDocument();

    rerender(<PaymentBadge source={OWING} isCompleted />);
    expect(
      screen.getByText(`Payment pending · ${formatCurrency(100000)}`),
    ).toBeInTheDocument();

    rerender(<PaymentBadge source={SETTLED} isCompleted />);
    expect(screen.getByText("Paid in full")).toBeInTheDocument();

    rerender(<PaymentBadge source={OWING} isCompleted cancellation={null} />);
    expect(screen.getByText(/Payment pending/)).toBeInTheDocument();
  });

  it.each(["cancelled", "refunded"] as const)(
    "says nothing is due once the project is %s — even a commissioned one with a balance",
    (cancellation) => {
      render(<PaymentBadge source={OWING} isCompleted cancellation={cancellation} />);
      const badge = screen.getByText(`Nothing due — ${cancellation}`);
      expect(badge).toBeInTheDocument();
      // Muted, never the red alert of a commissioned project with money owing.
      expect(badge.className).toMatch(/gray/);
      expect(badge.className).not.toMatch(/red|amber/);
      expect(screen.queryByText(/Payment pending|Balance/)).toBeNull();
    },
  );

  it("says nothing is due on a cancelled project that was paid in full, too", () => {
    render(<PaymentBadge source={SETTLED} cancellation="refunded" />);
    expect(screen.getByText("Nothing due — refunded")).toBeInTheDocument();
    expect(screen.queryByText("Paid in full")).toBeNull();
  });
});
