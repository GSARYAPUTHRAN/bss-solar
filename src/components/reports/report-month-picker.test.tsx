// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportMonthPicker } from "./report-month-picker";

const { push } = vi.hoisted(() => ({ push: vi.fn<(url: string, opts?: unknown) => void>() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/reports",
}));

const OPTIONS = [
  { value: "2026-11", label: "November 2026 (so far)" },
  { value: "2026-10", label: "October 2026" },
  { value: "2026-09", label: "September 2026" },
];

beforeEach(() => {
  push.mockClear();
  // Radix Select measures and scrolls; jsdom has neither.
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.releasePointerCapture ??= vi.fn();
});

describe("ReportMonthPicker", () => {
  it("shows the selected month under a 'Month' label", () => {
    render(<ReportMonthPicker month="2026-11" options={OPTIONS} />);
    expect(screen.getByRole("combobox", { name: "Month" })).toHaveTextContent(
      "November 2026 (so far)",
    );
  });

  it("navigates to the chosen month", async () => {
    const user = userEvent.setup();
    render(<ReportMonthPicker month="2026-11" options={OPTIONS} />);
    await user.click(screen.getByRole("combobox", { name: "Month" }));
    await user.click(await screen.findByRole("option", { name: "September 2026" }));
    expect(push).toHaveBeenCalledWith("/reports?month=2026-09", { scroll: false });
  });

  it("lists every month offered, newest first", async () => {
    const user = userEvent.setup();
    render(<ReportMonthPicker month="2026-10" options={OPTIONS} />);
    await user.click(screen.getByRole("combobox", { name: "Month" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(OPTIONS.map((o) => o.label));
  });

  it("is a 40px tap target on a phone", () => {
    render(<ReportMonthPicker month="2026-11" options={OPTIONS} />);
    expect(screen.getByRole("combobox", { name: "Month" }).className).toContain(
      "data-[size=default]:h-10",
    );
  });
});
