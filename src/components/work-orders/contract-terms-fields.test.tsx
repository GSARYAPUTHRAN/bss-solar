// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContractTermsFields } from "./contract-terms-fields";

function setup(props: Parameters<typeof ContractTermsFields>[0]) {
  const { container } = render(
    <form>
      <ContractTermsFields {...props} />
    </form>,
  );
  const form = container.querySelector("form") as HTMLFormElement;
  return {
    form,
    advance: screen.getByLabelText(/advance collected/i) as HTMLInputElement,
    total: screen.getByLabelText(/total cost/i) as HTMLInputElement,
  };
}

describe("ContractTermsFields", () => {
  it("submits both amounts, a new order starting with no advance", () => {
    const { form, advance, total } = setup({ defaultAdvance: 0 });
    expect(advance).toHaveValue(0);
    expect(total).toBeRequired();

    fireEvent.change(total, { target: { value: "195000" } });
    const data = new FormData(form);
    expect(data.get("advance_amount")).toBe("0");
    expect(data.get("total_cost")).toBe("195000");
    expect(form.checkValidity()).toBe(true);
  });

  it("blocks an advance larger than the total with the server's message", () => {
    const { form, advance, total } = setup({ defaultAdvance: 20000, defaultTotal: 195000 });

    fireEvent.change(advance, { target: { value: "200000" } });
    expect(form.checkValidity()).toBe(false);
    expect(advance.validationMessage).toBe("The advance cannot be more than the total cost.");
    expect(advance).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("The advance cannot be more than the total cost.")).toBeInTheDocument();

    // Raising the total instead fixes it just as well.
    fireEvent.change(total, { target: { value: "250000" } });
    expect(form.checkValidity()).toBe(true);
    expect(advance).not.toHaveAttribute("aria-invalid");
  });

  it("allows an advance equal to the total (paid in full at booking)", () => {
    const { form } = setup({ defaultAdvance: 195000, defaultTotal: 195000 });
    expect(form.checkValidity()).toBe(true);
  });

  it("when locked, shows the stored terms read-only and leaves them out of the submission", () => {
    const { form, advance, total } = setup({
      defaultAdvance: 20000,
      defaultTotal: 195000,
      locked: true,
    });
    expect(advance).toHaveValue("₹20,000.00");
    expect(total).toHaveValue("₹1,95,000.00");
    expect(advance).toHaveAttribute("readonly");
    expect(total).toHaveAttribute("readonly");
    expect(screen.getAllByText("Set by the office after approval.")).toHaveLength(2);

    const data = new FormData(form);
    expect(data.has("advance_amount")).toBe(false);
    expect(data.has("total_cost")).toBe(false);
  });
});
