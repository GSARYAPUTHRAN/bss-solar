import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import { fail, ok, type ActionResult } from "@/lib/result";
import type { Profile, UserRole } from "@/lib/types";
import type { DirectoryAccount } from "./coordinator-match";
import { isOfficeRole, isServiceEngineerRole, isSuperAdminRole } from "./role";

/**
 * Rules for changing who someone is on the team. Each returns the message to
 * show when the change must be refused, or `null` when it may go ahead. They
 * exist so a role change or deletion can never strand work:
 *   - a sale is shared by its coordinators (`work_order_coordinators`, which
 *     references the member `on delete restrict`) and may only be owned or
 *     shared by a coordinator or the office — so a member of a shared sale
 *     counts as owning work exactly like the coordinator who logged it;
 *   - service tickets reference their engineer `on delete set null` and may
 *     only be held by a service engineer — so without these checks deleting or
 *     re-roling an engineer would silently orphan their open tickets.
 */

/** Business that is still attached to a team member. */
export interface OwnedWork {
  /** Work orders they logged or share (membership, not just `coordinator_id`). */
  workOrders: number;
  /** Projects of the sales they share. */
  projects: number;
  /** Tickets assigned to them that are still open, scheduled or in progress. */
  activeTickets: number;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function salesWork(owned: OwnedWork): string | null {
  const parts = [
    owned.workOrders > 0 && count(owned.workOrders, "work order"),
    owned.projects > 0 && count(owned.projects, "project"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" and ") : null;
}

function openTickets(owned: OwnedWork): string {
  return count(owned.activeTickets, "open service ticket");
}

/** Why `name` cannot be deleted yet, or `null`. */
export function deletionBlocker(name: string, owned: OwnedWork): string | null {
  const sales = salesWork(owned);
  if (sales) {
    return `${name} still owns or shares ${sales}. Take them off those sales (Change coordinators on each work order) or delete that business first.`;
  }
  if (owned.activeTickets > 0) {
    return `${name} still has ${openTickets(owned)}. Reassign them to another engineer first.`;
  }
  return null;
}

/**
 * Why `name` cannot move from `from` to `to`, or `null`. The caller has already
 * ruled out self-changes and the immutable Super Admin seat.
 */
export function roleChangeBlocker(change: {
  name: string;
  from: UserRole;
  to: UserRole;
  /** Accounts holding office rights (admin + Super Admin), including `name`. */
  adminCount: number;
  owned: OwnedWork;
}): string | null {
  const { name, from, to, adminCount, owned } = change;
  if (from === to) return null;

  if (isOfficeRole(from) && !isOfficeRole(to) && adminCount <= 1) {
    return "At least one administrator is required.";
  }

  const sales = salesWork(owned);
  if (isServiceEngineerRole(to) && sales) {
    return `${name} owns or shares ${sales}. Service engineers cannot own sales work — take them off those sales first.`;
  }

  if (isServiceEngineerRole(from) && owned.activeTickets > 0) {
    return `${name} still has ${openTickets(owned)}. Only service engineers can hold tickets — reassign them first.`;
  }

  return null;
}

// --- Editing a member ----------------------------------------------------------

/**
 * Who may change what about a member from the Team page's Edit dialog, and what
 * a submitted edit comes to. The dialog hides what the viewer may not change and
 * `updateTeamMember` enforces the same rule on the server — both ask
 * `teamEditAuthority`, so the matrix lives in exactly one place.
 *
 * The role is deliberately not here: it has its own editor, and the Super Admin
 * seat is immutable from the app (see lib/domain/role.ts).
 */

/** A member as the Team page lists them: their profile and how they sign in. */
export interface TeamMember extends Profile {
  /** Login e-mail (`auth.users`); `null` only if it could not be read. */
  email: string | null;
}

/** The things the Edit dialog can change. */
export type TeamEditField = "name" | "phone" | "email" | "password";

/** Which of the fields a viewer may change on one member. */
export type TeamEditAuthority = Record<TeamEditField, boolean>;

type Who = { id: string; role: UserRole };

function authority(allowed: boolean): TeamEditAuthority {
  return { name: allowed, phone: allowed, email: allowed, password: allowed };
}

/**
 * What `viewer` may change about `target`.
 *
 *   Super Admin  everything, for anyone — themself and the admins included.
 *   Admin        the name and phone of coordinators, engineers and other admins;
 *                the e-mail and password (the login — changing someone's is an
 *                account takeover) only of coordinators, engineers and themself.
 *                Nothing at all of the Super Admin's.
 *   anyone else  nothing.
 */
export function teamEditAuthority(viewer: Who, target: Who): TeamEditAuthority {
  if (!isOfficeRole(viewer.role)) return authority(false);
  if (isSuperAdminRole(viewer.role)) return authority(true);
  if (isSuperAdminRole(target.role)) return authority(false);

  const login = target.id === viewer.id || !isOfficeRole(target.role);
  return { name: true, phone: true, email: login, password: login };
}

/** Whether the viewer may change anything — i.e. whether to offer Edit at all. */
export function canEditMember(allowed: TeamEditAuthority): boolean {
  return Object.values(allowed).some(Boolean);
}

/** Limits on what the dialog accepts (also set on its inputs). */
export const TEAM_NAME_LENGTH = { min: 2, max: 80 } as const;
export const TEAM_PHONE_MAX_LENGTH = 30;
/** bcrypt, which GoTrue hashes with, ignores everything past 72 bytes. */
export const TEAM_PASSWORD_MAX_LENGTH = 72;
const EMAIL_MAX_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Accounts made before anyone had a real address carry a placeholder on the
 * reserved `.invalid` TLD (`ravi@bsssolar.invalid`) and no usable password: they
 * exist as names on sales but nobody can sign in as them.
 */
export function hasPlaceholderEmail(email: string | null): boolean {
  return email !== null && /\.invalid$/i.test(email.trim());
}

/** Trimmed, with runs of whitespace made single: a name as it is stored. */
function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** What makes two names "the same": case and spacing, nothing cleverer. */
function nameKey(name: string): string {
  return cleanName(name).normalize("NFKC").toLowerCase();
}

/** What the dialog posted. A field that was not posted is `undefined`. */
export interface TeamEditPosted {
  fullName?: string;
  phone?: string;
  email?: string;
  password?: string;
}

/** The member being edited, as the database has them now. */
export type TeamEditTarget = Pick<TeamMember, "id" | "role" | "full_name" | "phone" | "email">;

/** The team's accounts, for the duplicate checks. */
export type TeamEditAccount = Pick<DirectoryAccount, "id" | "fullName" | "email">;

/** The `profiles` columns an edit writes. */
export interface TeamProfilePatch {
  full_name?: string;
  phone?: string | null;
}

/** What an edit writes to Auth (`auth.admin.updateUserById`). */
export interface TeamAuthPatch {
  email?: string;
  /** Held only long enough to be sent; never returned, logged or stored. */
  password?: string;
  /** Kept in `user_metadata.full_name` so Auth and the profile agree. */
  fullName?: string;
}

/** `null` = nothing to write there. Both `null` = nothing changed. */
export interface TeamEditPlan {
  profile: TeamProfilePatch | null;
  auth: TeamAuthPatch | null;
}

/** What an admin is told about another admin's login, which is not theirs to change. */
export const ADMIN_LOGIN_RESERVED =
  "Only the Super Admin can change another admin's e-mail or password.";

/** Why `viewer` may not make the change they asked for on `target`. */
function refusal(viewer: Who, target: TeamEditTarget): string {
  if (!isOfficeRole(viewer.role)) return "Only office staff can edit team members.";
  if (isSuperAdminRole(target.role)) {
    return "Only the Super Admin can change the Super Admin's details.";
  }
  return ADMIN_LOGIN_RESERVED;
}

/**
 * Turn a submitted edit into what to write — or the reason it cannot be.
 *
 * Everything is decided here, before the first write, so a refused edit leaves
 * nothing half-done:
 *   1. a viewer with no authority over the member at all is refused; otherwise a
 *      field they may not change is refused if it differs from what the member
 *      has now (posting a field unchanged is harmless, so a client that sends the
 *      whole form is not penalised);
 *   2. what changed is validated;
 *   3. a name or e-mail another account already has is refused. Names must stay
 *      unique because the bulk import finds coordinators by name.
 * A password counts as changed whenever it is not blank — blank keeps the
 * current one.
 */
export function planTeamEdit(input: {
  viewer: Who;
  target: TeamEditTarget;
  posted: TeamEditPosted;
  accounts: readonly TeamEditAccount[];
}): ActionResult<TeamEditPlan> {
  const { viewer, target, posted, accounts } = input;
  const allowed = teamEditAuthority(viewer, target);
  // Nothing here is theirs to change: refuse even a form that changes nothing.
  if (!canEditMember(allowed)) return fail(refusal(viewer, target));

  const name = posted.fullName === undefined ? undefined : cleanName(posted.fullName);
  const phone = posted.phone === undefined ? undefined : posted.phone.trim() || null;
  const email = posted.email === undefined ? undefined : posted.email.trim().toLowerCase();
  // Passwords are kept exactly as typed — the sign-in form does not trim either —
  // but one made only of spaces is a blank field, not a password.
  const password = posted.password?.trim() ? posted.password : undefined;

  const changed: Record<TeamEditField, boolean> = {
    name: name !== undefined && name !== target.full_name,
    phone: phone !== undefined && phone !== (target.phone?.trim() || null),
    email: email !== undefined && email !== (target.email ?? "").toLowerCase(),
    password: password !== undefined,
  };

  for (const field of Object.keys(changed) as TeamEditField[]) {
    if (changed[field] && !allowed[field]) return fail(refusal(viewer, target));
  }

  if (changed.name && name !== undefined) {
    const length = [...name].length;
    if (length < TEAM_NAME_LENGTH.min || length > TEAM_NAME_LENGTH.max) {
      return fail(
        `The name must be ${TEAM_NAME_LENGTH.min}–${TEAM_NAME_LENGTH.max} characters.`,
      );
    }
  }
  if (changed.phone && phone && phone.length > TEAM_PHONE_MAX_LENGTH) {
    return fail(`The phone number can be at most ${TEAM_PHONE_MAX_LENGTH} characters.`);
  }
  if (changed.email && email !== undefined) {
    if (email.length > EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(email)) {
      return fail("Enter a valid e-mail address.");
    }
  }
  if (changed.password && password !== undefined) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return fail(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (password.length > TEAM_PASSWORD_MAX_LENGTH) {
      return fail(`The password can be at most ${TEAM_PASSWORD_MAX_LENGTH} characters.`);
    }
  }

  const others = accounts.filter((account) => account.id !== target.id);
  if (changed.name && name !== undefined) {
    const key = nameKey(name);
    if (others.some((account) => nameKey(account.fullName) === key)) {
      return fail(
        `Another team member is already named "${name}". Names must be unique — the bulk import finds coordinators by name.`,
      );
    }
  }
  if (changed.email && email !== undefined) {
    if (others.some((account) => account.email?.toLowerCase() === email)) {
      return fail(`${email} already belongs to another team member.`);
    }
  }

  const profile: TeamProfilePatch = {};
  if (changed.name && name !== undefined) profile.full_name = name;
  if (changed.phone && phone !== undefined) profile.phone = phone;

  const auth: TeamAuthPatch = {};
  if (changed.email && email !== undefined) auth.email = email;
  if (changed.password) auth.password = password;
  if (changed.name && name !== undefined) auth.fullName = name;

  return ok({
    profile: Object.keys(profile).length > 0 ? profile : null,
    auth: Object.keys(auth).length > 0 ? auth : null,
  });
}
