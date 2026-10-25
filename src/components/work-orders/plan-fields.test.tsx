// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CAPACITY_PROBLEM } from "@/lib/domain/capacity";
import { PlanFields } from "./plan-fields";

function renderFields(props: React.ComponentProps<typeof PlanFields> = {}) {
  const view = render(
    <form data-testid="form">
      <PlanFields {...props}>
        <label htmlFor="order_date">Order date</label>
        <input id="order_date" name="order_date" />
      </PlanFields>
    </form>,
  );
  return view;
}

/** What the form would post. */
function posted(): Record<string, string> {
  const data = new FormData(screen.getByTestId("form") as HTMLFormElement);
  return {
    plan_type: String(data.get("plan_type")),
    plant_capacity: String(data.get("plant_capacity")),
  };
}

describe("PlanFields", () => {
  it("starts as a solar plant asking for the capacity", () => {
    renderFields();
    expect(screen.getByRole("radio", { name: "Solar plant" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Custom plan" })).not.toBeChecked();
    expect(screen.getByRole("group", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByLabelText(/plant capacity/i)).toBeRequired();
    expect(screen.queryByLabelText(/what was sold/i)).not.toBeInTheDocument();
    expect(posted()).toEqual({ plan_type: "solar", plant_capacity: "" });
  });

  it("switches to a custom plan: describe what was sold, no kW, no KSEB price", async () => {
    const user = userEvent.setup();
    renderFields();
    await user.type(screen.getByLabelText(/plant capacity/i), "3kW");
    expect(screen.getByText(/KSEB registration ₹/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Custom plan" }));
    const sold = screen.getByLabelText(/what was sold/i);
    expect(sold).toHaveAttribute("placeholder", "e.g. 1 panel, Inverter + panel");
    expect(sold).toHaveAttribute("maxlength", "120");
    expect(sold).toBeRequired();
    expect(sold).toHaveValue("");
    expect(screen.getByText(/single Handover step/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/plant capacity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/KSEB registration ₹/)).not.toBeInTheDocument();

    await user.type(sold, "Inverter + panel");
    expect(posted()).toEqual({ plan_type: "custom", plant_capacity: "Inverter + panel" });
  });

  it("accepts a custom label a solar plant would refuse", async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByRole("radio", { name: "Custom plan" }));
    const sold = screen.getByLabelText(/what was sold/i) as HTMLInputElement;
    await user.type(sold, "1 panel");
    expect(sold.checkValidity()).toBe(true);
    expect(sold).not.toHaveAttribute("aria-invalid");
  });

  it("keeps what was typed for each plan when flipping between them", async () => {
    const user = userEvent.setup();
    renderFields();
    await user.type(screen.getByLabelText(/plant capacity/i), "3kW");
    await user.click(screen.getByRole("radio", { name: "Custom plan" }));
    await user.type(screen.getByLabelText(/what was sold/i), "Inverter + panel");

    await user.click(screen.getByRole("radio", { name: "Solar plant" }));
    expect(screen.getByLabelText(/plant capacity/i)).toHaveValue("3kW");
    await user.click(screen.getByRole("radio", { name: "Custom plan" }));
    expect(screen.getByLabelText(/what was sold/i)).toHaveValue("Inverter + panel");
  });

  it("never carries a custom description into the solar capacity", async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByRole("radio", { name: "Custom plan" }));
    await user.type(screen.getByLabelText(/what was sold/i), "1 panel");
    await user.click(screen.getByRole("radio", { name: "Solar plant" }));
    // Not "1 panel" read as a 1 kW plant.
    expect(screen.getByLabelText(/plant capacity/i)).toHaveValue("");
  });

  it("blocks a solar label without a unit in the form", async () => {
    const user = userEvent.setup();
    renderFields();
    const capacity = screen.getByLabelText(/plant capacity/i) as HTMLInputElement;
    await user.type(capacity, "1 panel");
    expect(capacity.validationMessage).toBe(CAPACITY_PROBLEM);
  });

  it("is a plan chosen on the keyboard, like any radio group", async () => {
    const user = userEvent.setup();
    renderFields();
    screen.getByRole("radio", { name: "Solar plant" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Custom plan" })).toBeChecked();
    expect(posted().plan_type).toBe("custom");
  });

  it("starts from the stored plan and label when editing", () => {
    renderFields({ defaultPlan: "custom", defaultLabel: "Inverter + panel" });
    expect(screen.getByRole("radio", { name: "Custom plan" })).toBeChecked();
    expect(screen.getByLabelText(/what was sold/i)).toHaveValue("Inverter + panel");
  });

  it("does not flag an old solar label that was fine when it was saved", () => {
    renderFields({ defaultPlan: "solar", defaultLabel: "1 panel" });
    const capacity = screen.getByLabelText(/plant capacity/i) as HTMLInputElement;
    expect(capacity).toHaveValue("1 panel");
    expect(capacity.checkValidity()).toBe(true);
  });

  it("puts the beside-field next to the label", () => {
    renderFields();
    expect(screen.getByLabelText("Order date")).toBeInTheDocument();
  });

  describe("once the project exists", () => {
    it("shows the plan as a line, offers no choice, and still posts it", () => {
      renderFields({ lockedPlan: "custom", defaultLabel: "Inverter + panel" });
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      expect(
        screen.getByText(/Custom plan — fixed once the project has started\./),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/what was sold/i)).toHaveValue("Inverter + panel");
      expect(posted()).toEqual({ plan_type: "custom", plant_capacity: "Inverter + panel" });
    });

    it("keeps a solar plan's capacity editable, including a legacy label left as it was", () => {
      renderFields({ lockedPlan: "solar", defaultLabel: "1 panel" });
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      expect(screen.getByText(/Solar plant — fixed once the project has started\./)).toBeInTheDocument();
      const capacity = screen.getByLabelText(/plant capacity/i) as HTMLInputElement;
      expect(capacity.checkValidity()).toBe(true);
      expect(posted().plan_type).toBe("solar");
    });
  });
});
