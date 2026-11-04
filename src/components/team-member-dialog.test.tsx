// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ updateTeamMember: vi.fn() }));
vi.mock("@/app/(app)/team/actions", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import type { TeamMember } from "@/lib/domain/team";
import type { UserRole } from "@/lib/types";
import { TeamMemberDialog } from "./team-member-dialog";

const SUPER = { id: "super-1", role: "superadmin" as const };
const ADMIN = { id: "admin-1", role: "admin" as const };

const base = { created_at: "2026-01-01T00:00:00Z" };
/** The owner's case: misspelled, with a placeholder e-mail and no usable password. */
const RAVEE: TeamMember = {
  ...base,
  id: "ravee-1",
  full_name: "Ravee Kumar",
  phone: "9048001332",
  role: "coordinator",
  email: "ravi@bsssolar.invalid",
};
const PRIYA: TeamMember = {
  ...base,
  id: "priya-1",
  full_name: "Priya Suresh",
  phone: null,
  role: "coordinator",
  email: "priya@bsssolar.test",
};
const MEERA: TeamMember = {
  ...base,
  id: "admin-2",
  full_name: "Meera Pillai",
  phone: null,
  role: "admin",
  email: "meera@bsssolar.test",
};
const BOSS: TeamMember = {
  ...base,
  id: "super-1",
  full_name: "BSS SuperAdmin",
  phone: null,
  role: "superadmin",
  email: "super@bsssolar.test",
};

const NO_SIGN_IN_HINT =
  "This account has no sign-in yet — set the real e-mail and a password to let them in.";

async function openDialog(member: TeamMember, viewer: { id: string; role: UserRole } = ADMIN) {
  const user = userEvent.setup();
  render(<TeamMemberDialog member={member} viewer={viewer} />);
  await user.click(screen.getByRole("button", { name: `Edit ${member.full_name}` }));
  const dialog = await screen.findByRole("dialog", { name: `Edit ${member.full_name}` });
  return { user, dialog };
}

/** What the last submit sent to the action. */
function sent(): FormData {
  return actions.updateTeamMember.mock.calls.at(-1)?.[1] as FormData;
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.updateTeamMember.mockResolvedValue({ ok: true, data: { message: "Saved." } });
});

describe("TeamMemberDialog — the fields", () => {
  it("opens with the member's name, phone and e-mail, and a blank new password", async () => {
    const { dialog } = await openDialog(RAVEE);

    expect(within(dialog).getByLabelText(/full name/i)).toHaveValue("Ravee Kumar");
    expect(within(dialog).getByLabelText(/phone/i)).toHaveValue("9048001332");
    expect(within(dialog).getByLabelText(/e-mail/i)).toHaveValue("ravi@bsssolar.invalid");
    expect(within(dialog).getByLabelText(/new password/i)).toHaveValue("");
  });

  it("shows the role but offers no way to change it", async () => {
    const { dialog } = await openDialog(RAVEE);
    expect(dialog).toHaveTextContent(/Role: Coordinator\./);
    expect(within(dialog).queryByLabelText(/^role/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says the Super Admin seat cannot be changed here", async () => {
    const { dialog } = await openDialog(BOSS, SUPER);
    expect(dialog).toHaveTextContent(/Role: Super Admin\./);
    expect(dialog).toHaveTextContent(/set on the database and cannot be changed here/i);
  });

  it("explains an account with no sign-in yet", async () => {
    const { dialog } = await openDialog(RAVEE);
    expect(within(dialog).getByText(NO_SIGN_IN_HINT)).toBeInTheDocument();
  });

  it("does not tell an account with a real e-mail that it has no sign-in", async () => {
    const { dialog } = await openDialog(PRIYA);
    expect(within(dialog).queryByText(NO_SIGN_IN_HINT)).not.toBeInTheDocument();
  });

  it("tells the office the password may be left blank, and how long it must be", async () => {
    const { dialog } = await openDialog(RAVEE);
    expect(dialog).toHaveTextContent(
      `Leave blank to keep the current password. At least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  });

  it("keeps the password out of the browser's autofill and requires the minimum length", async () => {
    const { dialog } = await openDialog(RAVEE);
    const password = within(dialog).getByLabelText(/new password/i);
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toHaveAttribute("minlength", String(MIN_PASSWORD_LENGTH));
    expect(password).not.toBeRequired();
  });

  it("limits the name's length and requires the name and e-mail", async () => {
    const { dialog } = await openDialog(PRIYA);
    const name = within(dialog).getByLabelText(/full name/i);
    expect(name).toBeRequired();
    expect(name).toHaveAttribute("minlength", "2");
    expect(name).toHaveAttribute("maxlength", "80");
    expect(within(dialog).getByLabelText(/e-mail/i)).toBeRequired();
    expect(within(dialog).getByLabelText(/e-mail/i)).toHaveAttribute("type", "email");
  });

  it("does not insist on an e-mail it could not read", async () => {
    const { dialog } = await openDialog({ ...PRIYA, email: null });
    expect(within(dialog).getByLabelText(/e-mail/i)).not.toBeRequired();
    expect(within(dialog).getByLabelText(/e-mail/i)).toHaveValue("");
  });

  it("uses 40px tap targets on a phone", async () => {
    const { dialog } = await openDialog(RAVEE);
    // Hidden from the tree while the modal is open, but still the 40px target.
    expect(
      screen.getByRole("button", { name: "Edit Ravee Kumar", hidden: true }),
    ).toHaveClass("size-10");
    for (const label of [/full name/i, /phone/i, /e-mail/i, /new password/i]) {
      expect(within(dialog).getByLabelText(label)).toHaveClass("h-10");
    }
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toHaveClass("h-10");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveClass("h-10");
  });

  it("scrolls inside the screen rather than past it", async () => {
    const { dialog } = await openDialog(RAVEE);
    expect(dialog).toHaveClass("max-h-[90dvh]", "overflow-y-auto");
  });
});

describe("TeamMemberDialog — what the viewer may change", () => {
  it("offers the Super Admin every field for an admin", async () => {
    const { dialog } = await openDialog(MEERA, SUPER);
    for (const label of [/full name/i, /phone/i, /e-mail/i, /new password/i]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("offers an admin every field for a coordinator", async () => {
    const { dialog } = await openDialog(RAVEE, ADMIN);
    for (const label of [/full name/i, /phone/i, /e-mail/i, /new password/i]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("offers an admin every field for themself", async () => {
    const self: TeamMember = { ...MEERA, id: ADMIN.id, full_name: "BSS Admin" };
    const { dialog } = await openDialog(self, ADMIN);
    expect(within(dialog).getByLabelText(/e-mail/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/new password/i)).toBeInTheDocument();
  });

  it("hides another admin's e-mail and password from an admin, and says why", async () => {
    const { dialog } = await openDialog(MEERA, ADMIN);

    expect(within(dialog).getByLabelText(/full name/i)).toHaveValue("Meera Pillai");
    expect(within(dialog).getByLabelText(/phone/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/e-mail/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Only the Super Admin can change another admin's e-mail or password.",
    );
  });

  it("does not send the fields it hid", async () => {
    const { user, dialog } = await openDialog(MEERA, ADMIN);
    await user.clear(within(dialog).getByLabelText(/full name/i));
    await user.type(within(dialog).getByLabelText(/full name/i), "Meera Pillay");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(actions.updateTeamMember).toHaveBeenCalledTimes(1));
    expect(sent().get("full_name")).toBe("Meera Pillay");
    expect(sent().has("email")).toBe(false);
    expect(sent().has("password")).toBe(false);
  });

  it("offers an admin nothing at all for the Super Admin", () => {
    render(<TeamMemberDialog member={BOSS} viewer={ADMIN} />);
    expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
  });

  it("offers the Super Admin their own row", async () => {
    const { dialog } = await openDialog(BOSS, SUPER);
    expect(within(dialog).getByLabelText(/e-mail/i)).toHaveValue("super@bsssolar.test");
  });

  it("offers a coordinator nothing, not even on their own row", () => {
    render(
      <TeamMemberDialog member={PRIYA} viewer={{ id: PRIYA.id, role: "coordinator" }} />,
    );
    expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
  });
});

describe("TeamMemberDialog — saving", () => {
  it("sends the corrected name with the member's id, toasts Saved. and closes", async () => {
    const { user, dialog } = await openDialog(RAVEE);

    const name = within(dialog).getByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, "Ravi Kumar");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(actions.updateTeamMember).toHaveBeenCalledTimes(1));
    expect(actions.updateTeamMember.mock.calls[0][0]).toBeNull();
    expect(sent().get("id")).toBe("ravee-1");
    expect(sent().get("full_name")).toBe("Ravi Kumar");
    expect(sent().get("phone")).toBe("9048001332");
    expect(sent().get("email")).toBe("ravi@bsssolar.invalid");
    // Blank means "keep the current password".
    expect(sent().get("password")).toBe("");
    expect(sent().has("role")).toBe(false);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Saved.");
  });

  it("sends the real e-mail and a new password for an account with no sign-in", async () => {
    const { user, dialog } = await openDialog(RAVEE);

    const email = within(dialog).getByLabelText(/e-mail/i);
    await user.clear(email);
    await user.type(email, "ravi@bsssolar.in");
    await user.type(within(dialog).getByLabelText(/new password/i), "a-brand-new-secret");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(actions.updateTeamMember).toHaveBeenCalledTimes(1));
    expect(sent().get("email")).toBe("ravi@bsssolar.in");
    expect(sent().get("password")).toBe("a-brand-new-secret");
  });

  it("keeps the dialog, and what was typed, when the server refuses", async () => {
    actions.updateTeamMember.mockResolvedValue({
      ok: false,
      error:
        'Another team member is already named "Priya Suresh". Names must be unique — the bulk import finds coordinators by name.',
    });
    const { user, dialog } = await openDialog(RAVEE);

    const name = within(dialog).getByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, "Priya Suresh");
    await user.type(within(dialog).getByLabelText(/new password/i), "a-brand-new-secret");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already named "Priya Suresh"/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/full name/i)).toHaveValue("Priya Suresh");
    expect(within(dialog).getByLabelText(/new password/i)).toHaveValue("a-brand-new-secret");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the dialog and what was typed when the request never reaches the server", async () => {
    actions.updateTeamMember
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ ok: true, data: { message: "Saved." } });
    const { user, dialog } = await openDialog(RAVEE);

    const name = within(dialog).getByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, "Ravi Kumar");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the server — check your connection and try again.",
    );
    expect(within(dialog).getByLabelText(/full name/i)).toHaveValue("Ravi Kumar");
    expect(toast.success).not.toHaveBeenCalled();

    // Back online, the same edit goes through on a second tap.
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.updateTeamMember).toHaveBeenCalledTimes(2);
  });

  it("disables Save and says it is saving while the server works", async () => {
    let finish: (value: unknown) => void = () => {};
    actions.updateTeamMember.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, dialog } = await openDialog(RAVEE);

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    const saving = await within(dialog).findByRole("button", { name: /saving/i });
    expect(saving).toBeDisabled();
    expect(dialog.querySelector("form")).toHaveAttribute("aria-busy", "true");

    finish({ ok: true, data: { message: "Saved." } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("TeamMemberDialog — keyboard and focus", () => {
  it("moves focus into the dialog when it opens", async () => {
    const { dialog } = await openDialog(RAVEE);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("closes on Escape without saving, and gives focus back to the Edit button", async () => {
    const { user } = await openDialog(RAVEE);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.updateTeamMember).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit Ravee Kumar" })).toHaveFocus();
  });

  it("closes on Cancel without saving", async () => {
    const { user, dialog } = await openDialog(RAVEE);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.updateTeamMember).not.toHaveBeenCalled();
  });

  it("starts from the member as the page shows them each time it opens", async () => {
    const { user, dialog } = await openDialog(RAVEE);
    const name = within(dialog).getByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, "Typed then abandoned");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Edit Ravee Kumar" }));
    expect(await screen.findByLabelText(/full name/i)).toHaveValue("Ravee Kumar");
  });

  it("labels the dialog with the member it edits and describes what it does", async () => {
    const { dialog } = await openDialog(RAVEE);
    expect(dialog).toHaveAccessibleName("Edit Ravee Kumar");
    expect(dialog).toHaveAccessibleDescription(/correct this member's details/i);
  });
});
