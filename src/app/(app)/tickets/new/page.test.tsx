// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/data", () => ({
  projectsRepository: { options: vi.fn() },
  profilesRepository: { serviceEngineers: vi.fn() },
}));
vi.mock("../actions", () => ({ createTicket: vi.fn() }));

import { projectsRepository, profilesRepository } from "@/server/data";
import NewTicketPage from "./page";

// jsdom lacks what Radix Select needs to open its list.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.mocked(profilesRepository.serviceEngineers).mockResolvedValue([
    { id: "e1", full_name: "Anil Kumar" },
  ] as Awaited<ReturnType<typeof profilesRepository.serviceEngineers>>);
});

describe("the project picker on the new-ticket page", () => {
  it("says what each sale is — a capacity or a custom plan's details — and which are closed", async () => {
    vi.mocked(projectsRepository.options).mockResolvedValue([
      { id: "p1", client_name: "Anand Kumar", plant_capacity: "3kW", cancellation: null },
      {
        id: "p2",
        client_name: "Meera Nair",
        plant_capacity: "Inverter + panel",
        cancellation: null,
      },
      { id: "p3", client_name: "Sanu Raj", plant_capacity: "5kW", cancellation: "refunded" },
      { id: "p4", client_name: "Haneefa KK", plant_capacity: "Not recorded", cancellation: "cancelled" },
    ]);
    const user = userEvent.setup();
    render(
      await NewTicketPage({ searchParams: Promise.resolve({}) }),
    );

    await user.click(screen.getByRole("combobox", { name: /project \/ site/i }));
    expect(await screen.findByRole("option", { name: "Anand Kumar — 3kW" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Meera Nair — Inverter + panel" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sanu Raj — 5kW (Refunded)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Haneefa KK — Not recorded (Cancelled)" })).toBeInTheDocument();
  });
});
