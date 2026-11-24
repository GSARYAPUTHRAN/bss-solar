// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DuplicateNotice } from "@/lib/domain/import-duplicates";
import { DuplicateDialog } from "./duplicate-dialog";

beforeAll(() => {
  // Radix measures the checkbox with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const notice = (over: Partial<DuplicateNotice> = {}): DuplicateNotice => ({
  kind: "check",
  count: 2,
  byNameOnly: 0,
  valid: 5,
  addedOn: ["2026-11-08"],
  names: ["Vijayakumar R", "Santhi kumari"],
  ...over,
});

function show(n: DuplicateNotice | null, open = true) {
  const onClose = vi.fn();
  const onChoose = vi.fn();
  const view = render(
    <DuplicateDialog notice={n} open={open} onClose={onClose} onChoose={onChoose} />,
  );
  return { onClose, onChoose, user: userEvent.setup(), ...view };
}

describe("DuplicateDialog — after Check file", () => {
  it("is a labelled modal: what was found, which customers, and what Import will do", () => {
    show(notice());
    const dialog = screen.getByRole("dialog", {
      name: "Some of these sales are already in the system",
    });
    expect(dialog).toHaveAccessibleDescription(
      "2 of 5 rows match sales already in the system (same customer and order date). They were added on 8 Nov 2026.",
    );
    expect(within(dialog).getByText("Vijayakumar R and Santhi kumari")).toBeVisible();
    expect(
      within(dialog).getByText(
        "If you import, these rows are skipped unless you choose to import them again.",
      ),
    ).toBeVisible();
  });

  it("says when rows with no order date were matched by name alone", () => {
    show(notice({ byNameOnly: 1 }));
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "2 of 5 rows match sales already in the system (same customer and order date; 1 with no order date in the sheet matches by name alone). They were added on 8 Nov 2026.",
    );
  });

  it("only asks to be acknowledged, and starts there", () => {
    show(notice());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["OK"]);
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "OK" })).toHaveFocus();
  });

  it("closes on OK and on Escape, choosing nothing", async () => {
    const first = show(notice());
    await first.user.click(screen.getByRole("button", { name: "OK" }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = show(notice());
    await second.user.keyboard("{Escape}");
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.onChoose).not.toHaveBeenCalled();
  });

  it("says the sheet was already uploaded when every valid row is in", () => {
    show(notice({ count: 5, valid: 5 }));
    expect(screen.getByRole("dialog", { name: "This sheet was already uploaded" })).toBeVisible();
  });

  it("names ten customers and counts the rest", () => {
    const names = Array.from({ length: 13 }, (_, i) => `Customer ${i + 1}`);
    show(notice({ count: 13, valid: 20, names }));
    expect(screen.getByText(/^Customer 1, Customer 2, .*Customer 10 and 3 more$/)).toBeVisible();
  });

  it("is not shown when closed or with nothing to say", () => {
    show(notice(), false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    show(null, true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("DuplicateDialog — Import projects stopped for a choice", () => {
  const confirm = (over: Partial<DuplicateNotice> = {}) => notice({ kind: "confirm", ...over });

  it("offers to skip them and import the rest, as the first and focused choice", () => {
    show(confirm());
    const dialog = screen.getByRole("dialog");
    const skip = within(dialog).getByRole("button", {
      name: "Skip the 2 already in the system and import the other 3",
    });
    expect(skip).toHaveFocus();
    expect(within(dialog).getByText("Nothing has been imported yet.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("skips on the first choice", async () => {
    const { user, onChoose, onClose } = show(confirm());
    await user.click(screen.getByRole("button", { name: /^skip the 2/i }));
    expect(onChoose).toHaveBeenCalledWith("skip");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("imports them all only after the admin ticks that duplicates will be created", async () => {
    const { user, onChoose } = show(confirm());
    const all = screen.getByRole("button", { name: "Import all 5 anyway" });
    expect(all).toBeDisabled();
    await user.click(all);
    expect(onChoose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: "I understand this creates duplicate sales" }));
    expect(all).toBeEnabled();
    await user.click(all);
    expect(onChoose).toHaveBeenCalledWith("include");
  });

  it("chooses nothing on Cancel or Escape", async () => {
    const first = show(confirm());
    await first.user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    expect(first.onChoose).not.toHaveBeenCalled();
    first.unmount();

    const second = show(confirm());
    await second.user.keyboard("{Escape}");
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.onChoose).not.toHaveBeenCalled();
  });

  it("keeps focus inside while open", async () => {
    const { user } = show(confirm());
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("with nothing new, says so: no skip, Close first, importing all still behind the tick", async () => {
    const { user, onChoose, onClose } = show(confirm({ count: 3, valid: 3 }));
    const dialog = screen.getByRole("dialog", { name: "This sheet was already uploaded" });
    expect(within(dialog).getByText("Nothing new to import.")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: /^skip/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Import all 3 anyway" })).toBeDisabled();

    await user.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("says 'Import it anyway' for a one-row sheet", () => {
    show(confirm({ count: 1, valid: 1, names: ["Vijayakumar R"] }));
    expect(screen.getByRole("button", { name: "Import it anyway" })).toBeDisabled();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      /^1 of 1 row matches a sale already in the system .* It was added on 8 Nov 2026\.$/,
    );
  });

  it("starts with the tick box clear every time it opens", async () => {
    const onClose = vi.fn();
    const onChoose = vi.fn();
    const user = userEvent.setup();
    const n = confirm();
    const { rerender } = render(
      <DuplicateDialog notice={n} open onClose={onClose} onChoose={onChoose} />,
    );
    await user.click(screen.getByRole("checkbox", { name: /i understand/i }));
    expect(screen.getByRole("checkbox", { name: /i understand/i })).toBeChecked();

    rerender(<DuplicateDialog notice={n} open={false} onClose={onClose} onChoose={onChoose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<DuplicateDialog notice={n} open onClose={onClose} onChoose={onChoose} />);
    expect(screen.getByRole("checkbox", { name: /i understand/i })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Import all 5 anyway" })).toBeDisabled();
  });
});
