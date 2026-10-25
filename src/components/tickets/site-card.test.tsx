// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteCard } from "./site-card";

const SITE = {
  client_name: "Anand Kumar",
  client_phone: "9876543210",
  address: "Kochi",
  plant_capacity: "Inverter + panel",
  consumer_number: "1234567",
  kseb_section: "Edappally",
};

describe("SiteCard", () => {
  it("calls the capacity the 'System' — a custom plan has details, not kW", () => {
    render(<SiteCard site={SITE} />);
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Inverter + panel")).toBeInTheDocument();
    expect(screen.queryByText("Plant capacity")).not.toBeInTheDocument();
  });
});
