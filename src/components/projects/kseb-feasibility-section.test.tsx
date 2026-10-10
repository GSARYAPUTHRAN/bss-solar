// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting (Node prints paise, some browsers do not).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { feasibilityStatus } from "@/lib/domain/kseb";
import { formatCurrency } from "@/lib/format";
import { KsebFeasibilitySection } from "./kseb-feasibility-section";
import { IncentiveAmount } from "./incentive-badge";

const TODAY = "2026-10-10";

/** The <dd> paired with a <dt> label. */
function valueOf(label: string | RegExp): string | null {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? null;
}

describe("KsebFeasibilitySection", () => {
  it("prices the customer's KSEB fees from the plant's kW", () => {
    render(
      <KsebFeasibilitySection
        feasibility={feasibilityStatus({ feasibilityDate: null, today: TODAY })}
        feasibilityDate={null}
        capacityKw={5}
        capacityLabel="5kW"
        ksebCollected={1000}
      />,
    );
    expect(valueOf("Feasibility fee")).toBe(formatCurrency(1000));
    expect(valueOf(/^Registration · 5 kW × /)).toBe(formatCurrency(5000));
    expect(valueOf(/GST 18%/)).toBe(formatCurrency(900));
    expect(valueOf("Total payable by customer")).toBe(formatCurrency(6900));
    expect(valueOf("Collected through BSS")).toBe(formatCurrency(1000));
    expect(valueOf("Feasibility date")).toBe("Not captured yet");
  });

  it("explains, rather than guesses, when the capacity has no kW figure", () => {
    render(
      <KsebFeasibilitySection
        feasibility={feasibilityStatus({ feasibilityDate: null, today: TODAY })}
        feasibilityDate={null}
        capacityKw={null}
        capacityLabel="Hybrid"
        ksebCollected={0}
      />,
    );
    expect(valueOf("Registration")).toBe("Capacity not in kW");
    expect(valueOf("Total payable by customer")).toBe("—");
    expect(screen.getByText(/“Hybrid” has no kW figure/)).toBeInTheDocument();
  });

  it("shows the running clock and what renewals have cost BSS", () => {
    // 40 days in: second period, 20 days left, one ₹1,000 renewal.
    const status = feasibilityStatus({ feasibilityDate: "2026-08-31", today: TODAY });
    render(
      <KsebFeasibilitySection
        feasibility={status}
        feasibilityDate="2026-08-31"
        capacityKw={3}
        capacityLabel="3kW"
        ksebCollected={0}
      />,
    );
    expect(valueOf("Days left")).toBe("20 days");
    expect(valueOf("Renewals")).toBe("1");
    expect(valueOf("BSS extension cost")).toBe(formatCurrency(1000));
    expect(screen.getByText("Extended ×1")).toBeInTheDocument();
  });

  it("reads 'closed' once the plant is commissioned", () => {
    const status = feasibilityStatus({
      feasibilityDate: "2026-08-01",
      completedAt: "2026-09-15T06:00:00Z",
      isCompleted: true,
      today: TODAY,
    });
    render(
      <KsebFeasibilitySection
        feasibility={status}
        feasibilityDate="2026-08-01"
        capacityKw={3}
        capacityLabel="3kW"
        ksebCollected={0}
      />,
    );
    expect(valueOf("Days left")).toBe("Closed at commissioning");
  });
});

describe("IncentiveAmount", () => {
  it("shows an em dash when no incentive is set", () => {
    const { container } = render(<IncentiveAmount incentive={null} paidOn={null} />);
    expect(container).toHaveTextContent("—");
  });

  it("shows the amount with its pending state", () => {
    render(<IncentiveAmount incentive={2750} paidOn={null} />);
    expect(screen.getByText(formatCurrency(2750))).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows when it was paid", () => {
    render(<IncentiveAmount incentive={2750} paidOn="2026-10-01" />);
    expect(screen.getByText(/^Paid /)).toHaveTextContent("Paid 01 Oct 2026");
  });
});
