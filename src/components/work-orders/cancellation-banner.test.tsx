// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CancellationBanner } from "./cancellation-banner";

describe("CancellationBanner", () => {
  it("says when and why, with the office's remarks", () => {
    render(
      <CancellationBanner
        cancellation="refunded"
        cancelledOn="2025-02-12"
        remarks="₹20,000 returned by bank transfer on 20 Feb"
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "Refunded on 12 Feb 2025 — ₹20,000 returned by bank transfer on 20 Feb",
    );
    expect(screen.getByText("Refunded")).toContainHTML("strong");
  });

  it("admits when the date was never recorded (a bulk-loaded row)", () => {
    render(<CancellationBanner cancellation="cancelled" cancelledOn={null} remarks={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled (date not recorded)");
    expect(screen.getByRole("status")).not.toHaveTextContent("—");
  });

  it("leaves out blank remarks", () => {
    render(<CancellationBanner cancellation="cancelled" cancelledOn="2025-02-12" remarks="  " />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Cancelled on 12 Feb 2025$/);
  });

  it("offers the office the project, and coordinators nothing to manage", () => {
    const { rerender } = render(
      <CancellationBanner
        cancellation="refunded"
        cancelledOn="2025-02-12"
        remarks={null}
        manageHref="/projects/p-1"
      />,
    );
    expect(screen.getByRole("link", { name: /manage on the project/i })).toHaveAttribute(
      "href",
      "/projects/p-1",
    );
    rerender(
      <CancellationBanner cancellation="refunded" cancelledOn="2025-02-12" remarks={null} />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
