// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CAPACITY_PROBLEM } from "@/lib/domain/capacity";
import { CapacityField } from "./capacity-field";

function setup(
  defaultValue?: string,
  extra: Partial<React.ComponentProps<typeof CapacityField>> = {},
) {
  render(
    <>
      <label htmlFor="cap">Plant capacity</label>
      <CapacityField
        id="cap"
        name="plant_capacity"
        defaultValue={defaultValue}
        suggestions={["3kW", "5kW"]}
        {...extra}
      />
    </>,
  );
  return screen.getByLabelText("Plant capacity");
}

describe("CapacityField", () => {
  it("prompts for a unit while empty", () => {
    const input = setup();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText(/include the unit, e\.g\. 3kW/i)).toBeInTheDocument();
  });

  it("reads the kW and prices KSEB registration as the label is typed", () => {
    const input = setup();
    fireEvent.change(input, { target: { value: "3kW" } });
    expect(input).toHaveAccessibleDescription(
      "3 kW · KSEB registration ₹3,540.00 (₹3,000.00 + ₹540.00 GST)",
    );

    // Watts are converted, exactly as the database derives plant_capacity_kw.
    fireEvent.change(input, { target: { value: "3000 W" } });
    expect(input).toHaveAccessibleDescription(/^3 kW · KSEB registration ₹3,540\.00/);
  });

  it("flags a label the server would reject, and points at Custom plan", () => {
    const input = setup("three kilowatt");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(CAPACITY_PROBLEM);
  });

  it("flags a number without a unit — \"1 panel\" is not a 1 kW plant", () => {
    const input = setup();
    fireEvent.change(input, { target: { value: "1 panel" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(CAPACITY_PROBLEM);
    // …and no KSEB price is quoted for it.
    expect(screen.queryByText(/KSEB registration/)).not.toBeInTheDocument();
  });

  it("blocks the submit of a label the server would reject, and clears once fixed", () => {
    const input = setup("three kilowatt") as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe(CAPACITY_PROBLEM);

    fireEvent.change(input, { target: { value: "3 kW" } });
    expect(input.checkValidity()).toBe(true);
  });

  it("leaves a blank label to the required check", () => {
    const input = setup() as HTMLInputElement;
    expect(input.validity.customError).toBe(false);
    expect(input.validity.valueMissing).toBe(true);
  });

  it("lets an old order keep its stored label, but not another one like it", () => {
    const input = setup("1 panel", { previous: "1 panel" }) as HTMLInputElement;
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input.checkValidity()).toBe(true);

    fireEvent.change(input, { target: { value: "2 panels" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.checkValidity()).toBe(false);
  });

  it("tells the parent the label as it is typed", () => {
    const onLabelChange = vi.fn();
    const input = setup("", { onLabelChange });
    fireEvent.change(input, { target: { value: "5kW" } });
    expect(onLabelChange).toHaveBeenLastCalledWith("5kW");
  });

  it("keeps the field named for the form and offers suggestions", () => {
    const input = setup("5kW");
    expect(input).toHaveAttribute("name", "plant_capacity");
    expect(input).toBeRequired();
    const list = document.getElementById(input.getAttribute("list") ?? "");
    expect(list?.querySelectorAll("option")).toHaveLength(2);
  });
});
