// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatDate } from "@/lib/format";
import { AdvanceDetailsFields } from "./advance-details-fields";

const TODAY = "2026-10-10";

// jsdom lacks what Radix Select needs to open its list.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

function setup(props: Partial<Parameters<typeof AdvanceDetailsFields>[0]> = {}) {
  const { container } = render(
    <form>
      <AdvanceDetailsFields today={TODAY} {...props} />
    </form>,
  );
  return container.querySelector("form") as HTMLFormElement;
}

describe("AdvanceDetailsFields", () => {
  it("is optional all the way: a new order posts 'not recorded', no date, no reference", () => {
    const form = setup();
    const data = new FormData(form);
    expect(data.get("advance_method")).toBe("none");
    expect(data.get("advance_paid_on")).toBe("");
    expect(data.get("advance_reference")).toBe("");
    expect(form.checkValidity()).toBe(true);
    expect(screen.getByRole("combobox", { name: /advance method/i })).toHaveTextContent(
      "Not recorded",
    );
  });

  it("starts from what is stored", () => {
    const form = setup({
      defaultMethod: "upi",
      defaultPaidOn: "2025-02-04",
      defaultReference: "UPI 4410021199",
    });
    expect(screen.getByRole("combobox", { name: /advance method/i })).toHaveTextContent("UPI");
    expect(screen.getByLabelText(/advance received on/i)).toHaveValue("2025-02-04");
    expect(screen.getByLabelText(/advance reference/i)).toHaveValue("UPI 4410021199");
    const data = new FormData(form);
    expect(data.get("advance_method")).toBe("upi");
    expect(data.get("advance_paid_on")).toBe("2025-02-04");
    expect(data.get("advance_reference")).toBe("UPI 4410021199");
  });

  it("offers every payment method, or none", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("combobox", { name: /advance method/i }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Not recorded",
      "Cash",
      "UPI",
      "Bank transfer",
      "Cheque",
      "Loan disbursement",
      "Other",
    ]);
  });

  it("lets the method be put back to not recorded", async () => {
    const user = userEvent.setup();
    const form = setup({ defaultMethod: "cheque" });
    await user.click(screen.getByRole("combobox", { name: /advance method/i }));
    await user.click(await screen.findByRole("option", { name: "Not recorded" }));
    expect(new FormData(form).get("advance_method")).toBe("none");
  });

  it("only takes a date that has happened", () => {
    setup();
    expect(screen.getByLabelText(/advance received on/i)).toHaveAttribute("max", TODAY);
  });

  it("holds the reference to a sensible length", () => {
    setup();
    expect(screen.getByLabelText(/advance reference/i)).toHaveAttribute("maxlength", "100");
  });

  describe("when locked (a coordinator, once the office has reviewed the order)", () => {
    it("shows the stored details read-only and leaves them out of the submission", () => {
      const form = setup({
        locked: true,
        defaultMethod: "bank_transfer",
        defaultPaidOn: "2025-02-04",
        defaultReference: "UTR 8820113345",
      });
      expect(screen.getByLabelText(/advance method/i)).toHaveValue("Bank transfer");
      expect(screen.getByLabelText(/advance received on/i)).toHaveValue(formatDate("2025-02-04"));
      expect(screen.getByLabelText(/advance reference/i)).toHaveValue("UTR 8820113345");
      for (const field of ["advance_method", "advance_paid_on", "advance_reference"]) {
        expect(document.getElementById(field)).toHaveAttribute("readonly");
      }
      expect(screen.getByText("Set by the office after approval.")).toBeInTheDocument();

      const data = new FormData(form);
      expect(data.has("advance_method")).toBe(false);
      expect(data.has("advance_paid_on")).toBe(false);
      expect(data.has("advance_reference")).toBe(false);
    });

    it("shows a dash for what was never recorded", () => {
      setup({ locked: true });
      expect(screen.getByLabelText(/advance method/i)).toHaveValue("—");
      expect(screen.getByLabelText(/advance received on/i)).toHaveValue("—");
      expect(screen.getByLabelText(/advance reference/i)).toHaveValue("—");
    });
  });
});
