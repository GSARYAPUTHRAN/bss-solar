// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { periodOptions } from "@/lib/domain/service-report";
import { ServicesPeriodPicker, servicesReportHref } from "./services-period-picker";

const { push } = vi.hoisted(() => ({
  push: vi.fn<(url: string, opts?: unknown) => void>(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

// jsdom lacks what Radix Select needs to open its list.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => push.mockClear());

const TODAY = "2026-11-24";
const OPTIONS = periodOptions("2026-09", TODAY, { kind: "month", month: "2026-11" });

function picker() {
  return screen.getByRole("combobox", { name: "Period" });
}

describe("ServicesPeriodPicker", () => {
  it("shows the chosen period", () => {
    render(<ServicesPeriodPicker value="2026-11" options={OPTIONS} />);
    expect(picker()).toHaveTextContent("November 2026 (so far)");
  });

  it("shows All time when that is chosen", () => {
    render(<ServicesPeriodPicker value="all" options={OPTIONS} />);
    expect(picker()).toHaveTextContent("All time");
  });

  it("offers All time first, then the months newest first", async () => {
    render(<ServicesPeriodPicker value="2026-11" options={OPTIONS} />);
    await userEvent.setup().click(picker());
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "All time",
      "November 2026 (so far)",
      "October 2026",
      "September 2026",
    ]);
  });

  it("navigates to the month picked, keeping it in the URL", async () => {
    render(<ServicesPeriodPicker value="2026-11" options={OPTIONS} />);
    const user = userEvent.setup();
    await user.click(picker());
    await user.click(await screen.findByRole("option", { name: "October 2026" }));
    expect(push).toHaveBeenCalledWith("/reports/services?month=2026-10", { scroll: false });
  });

  it("navigates to all time", async () => {
    render(<ServicesPeriodPicker value="2026-11" options={OPTIONS} />);
    const user = userEvent.setup();
    await user.click(picker());
    await user.click(await screen.findByRole("option", { name: "All time" }));
    expect(push).toHaveBeenCalledWith("/reports/services?month=all", { scroll: false });
  });

  it("stays put when the chosen period is picked again", async () => {
    render(<ServicesPeriodPicker value="2026-10" options={OPTIONS} />);
    const user = userEvent.setup();
    await user.click(picker());
    await user.click(await screen.findByRole("option", { name: "October 2026" }));
    expect(push).not.toHaveBeenCalled();
  });

  it("is a phone-sized tap target", () => {
    render(<ServicesPeriodPicker value="2026-11" options={OPTIONS} />);
    expect(picker().className).toContain("data-[size=default]:h-10");
  });
});

describe("servicesReportHref", () => {
  it("puts the period in ?month=", () => {
    expect(servicesReportHref("2026-02")).toBe("/reports/services?month=2026-02");
    expect(servicesReportHref("all")).toBe("/reports/services?month=all");
  });
});
