// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KsebFeesEstimate, NO_KSEB_NOTE } from "./kseb-fees-estimate";

describe("KsebFeesEstimate", () => {
  it("prices a solar plant's KSEB charges from its kW", () => {
    render(<KsebFeesEstimate kw={3} plan="solar" />);
    expect(screen.getByText(/KSEB charges \(paid by the customer\)/)).toBeInTheDocument();
    expect(screen.getByText("Registration (3 kW)")).toBeInTheDocument();
    expect(screen.getByText("₹3,000.00 + ₹540.00 GST")).toBeInTheDocument();
  });

  it("is a solar plant when no plan is given (rows from before plans existed)", () => {
    render(<KsebFeesEstimate kw={5} />);
    expect(screen.getByText("Registration (5 kW)")).toBeInTheDocument();
  });

  it("says there is nothing to estimate for a custom plan, whatever kW it carries", () => {
    render(<KsebFeesEstimate kw={1} plan="custom" />);
    expect(screen.getByText(NO_KSEB_NOTE)).toBeInTheDocument();
    expect(NO_KSEB_NOTE).toBe("Custom plan — no KSEB registration or feasibility.");
    expect(screen.queryByText(/KSEB charges/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Registration/)).not.toBeInTheDocument();
  });

  it("flags a solar plant whose capacity cannot be priced", () => {
    render(<KsebFeesEstimate kw={null} plan="solar" />);
    expect(screen.getByText(/Capacity has no number/)).toBeInTheDocument();
  });
});
