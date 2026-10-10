// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CapacityField } from "./capacity-field";

function setup(defaultValue?: string) {
  render(
    <>
      <label htmlFor="cap">Plant capacity</label>
      <CapacityField
        id="cap"
        name="plant_capacity"
        defaultValue={defaultValue}
        suggestions={["3kW", "5kW"]}
      />
    </>,
  );
  return screen.getByLabelText("Plant capacity");
}

describe("CapacityField", () => {
  it("prompts for a number while empty", () => {
    const input = setup();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText(/include the number, e\.g\. 3kW/i)).toBeInTheDocument();
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

  it("flags a label the server would reject", () => {
    const input = setup("three kilowatt");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/add a number so KSEB fees can be priced/i);
  });

  it("blocks the submit of a label the server would reject, and clears once fixed", () => {
    const input = setup("three kilowatt") as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe(
      "Add a number so KSEB fees can be priced, e.g. 3kW.",
    );

    fireEvent.change(input, { target: { value: "3 kilowatt" } });
    expect(input.checkValidity()).toBe(true);
  });

  it("leaves a blank label to the required check", () => {
    const input = setup() as HTMLInputElement;
    expect(input.validity.customError).toBe(false);
    expect(input.validity.valueMissing).toBe(true);
  });

  it("keeps the field named for the form and offers suggestions", () => {
    const input = setup("5kW");
    expect(input).toHaveAttribute("name", "plant_capacity");
    expect(input).toBeRequired();
    const list = document.getElementById(input.getAttribute("list") ?? "");
    expect(list?.querySelectorAll("option")).toHaveLength(2);
  });
});
