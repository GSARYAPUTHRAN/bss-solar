// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BulkImportForm } from "./bulk-import-form";

vi.mock("@/app/(app)/onboarding/actions", () => ({ importProjects: vi.fn() }));

beforeAll(() => {
  // Radix measures the checkbox with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const COORDINATOR = "10000000-0000-0000-0000-000000000001";

describe("BulkImportForm — skip existing", () => {
  it("says only rows with a consumer number are protected, and what to re-upload", () => {
    render(
      <BulkImportForm
        coordinators={[{ value: COORDINATOR, label: "Rahul · Coordinator" }]}
        defaultCoordinatorId={COORDINATOR}
      />,
    );
    const skip = screen.getByRole("checkbox", {
      name: /skip rows whose consumer number already exists/i,
    });
    expect(skip).toBeChecked();
    expect(skip).toHaveAccessibleDescription(/rows without a consumer number are imported again/i);
    expect(skip).toHaveAccessibleDescription(/upload the failed-rows download/i);
    expect(skip).not.toHaveAccessibleDescription(/makes re-uploading safe/i);
  });
});
