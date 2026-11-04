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

  describe("details of the advance (method, date, reference) with no advance amount", () => {
    // The details are another component's fields in the same form.
    function withDetails(defaultAdvance: number) {
      const { container } = render(
        <form>
          <ContractTermsFields defaultAdvance={defaultAdvance} defaultTotal={195000} />
          <input aria-label="method" name="advance_method" defaultValue="none" />
          <input aria-label="paid on" name="advance_paid_on" />
          <input aria-label="reference" name="advance_reference" />
        </form>,
      );
      return {
        form: container.querySelector("form") as HTMLFormElement,
        advance: screen.getByLabelText(/advance collected/i) as HTMLInputElement,
        method: screen.getByLabelText("method"),
        paidOn: screen.getByLabelText("paid on"),
        reference: screen.getByLabelText("reference"),
      };
    }
    const MESSAGE = /there is no advance amount/i;

    it("blocks the submit with the server's message, and clears once either side is fixed", () => {
      const { form, advance, method, reference } = withDetails(0);
      expect(form.checkValidity()).toBe(true);

      fireEvent.change(method, { target: { value: "upi" } });
      expect(form.checkValidity()).toBe(false);
      expect(advance.validationMessage).toMatch(MESSAGE);
      expect(advance).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(MESSAGE)).toBeInTheDocument();

      // Entering the advance fixes it ...
      fireEvent.change(advance, { target: { value: "25000" } });
      expect(form.checkValidity()).toBe(true);
      // ... and so does clearing it again, whichever detail was the one filled.
      fireEvent.change(advance, { target: { value: "" } });
      expect(form.checkValidity()).toBe(false);
      fireEvent.change(method, { target: { value: "none" } });
      expect(form.checkValidity()).toBe(true);
      fireEvent.change(reference, { target: { value: "UTR 1" } });
      expect(form.checkValidity()).toBe(false);
      fireEvent.change(reference, { target: { value: "  " } });
      expect(form.checkValidity()).toBe(true);
    });

    it("counts a date alone, and a zero advance as no advance", () => {
      const { form, paidOn } = withDetails(0);
      fireEvent.change(paidOn, { target: { value: "2026-06-01" } });
      expect(form.checkValidity()).toBe(false);
    });

    it("leaves an order that has an advance alone", () => {
      const { form } = withDetails(30000);
      expect(form.checkValidity()).toBe(true);
    });

    it("keeps the over-total message when both apply", () => {
      const { form, advance, method } = withDetails(0);
      fireEvent.change(method, { target: { value: "upi" } });
      fireEvent.change(advance, { target: { value: "999999" } });
      expect(advance.validationMessage).toBe("The advance cannot be more than the total cost.");
      expect(form.checkValidity()).toBe(false);
    });
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
