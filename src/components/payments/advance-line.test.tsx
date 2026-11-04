// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatCurrency, formatDate } from "@/lib/format";
import { AdvanceLine } from "./advance-line";

describe("AdvanceLine", () => {
  it("reads as one line: the advance, how, when and the reference", () => {
    render(
      <AdvanceLine
        amount={50000}
        details={{
          advance_method: "upi",
          advance_paid_on: "2025-02-04",
          advance_reference: "UTR 4410021199",
        }}
      />,
    );
    expect(
      screen.getByText(
        `Advance ${formatCurrency(50000)} · UPI · ${formatDate("2025-02-04")} · UTR 4410021199`,
      ),
    ).toBeInTheDocument();
  });

  it("is just the amount when nothing else was recorded", () => {
    render(<AdvanceLine amount={20000} />);
    expect(screen.getByText(`Advance ${formatCurrency(20000)}`)).toBeInTheDocument();
  });

  it("renders nothing for a sale with no advance and no details", () => {
    const { container } = render(<AdvanceLine amount={0} details={{ advance_method: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
