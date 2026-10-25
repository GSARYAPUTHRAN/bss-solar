// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoordinatorNames } from "./coordinator-names";

describe("CoordinatorNames", () => {
  describe("inline", () => {
    it("is the default and reads as one phrase", () => {
      render(<CoordinatorNames names={["Ravi", "Abhijith"]} />);
      expect(screen.getByText("Ravi & Abhijith")).toBeInTheDocument();
    });

    it.each([
      [["Ravi"], "Ravi"],
      [["Ravi", "Abhijith", "Manohar"], "Ravi, Abhijith & Manohar"],
      [[], "—"],
      [["", "  "], "—"],
    ])("renders %j as %j", (names, text) => {
      render(<CoordinatorNames names={names} variant="inline" />);
      expect(screen.getByText(text)).toBeInTheDocument();
    });

    it("passes a class name through", () => {
      render(<CoordinatorNames names={["Ravi"]} className="text-xs" />);
      expect(screen.getByText("Ravi")).toHaveClass("text-xs");
    });
  });

  describe("chips", () => {
    it("gives each person their own badge, in order", () => {
      render(<CoordinatorNames names={["Ravi", "Abhijith", "Manohar"]} variant="chips" />);
      const badges = screen.getAllByText(/Ravi|Abhijith|Manohar/);
      expect(badges.map((b) => b.textContent)).toEqual(["Ravi", "Abhijith", "Manohar"]);
      for (const badge of badges) expect(badge).toHaveAttribute("data-slot", "badge");
    });

    it("wraps rather than overflowing a phone", () => {
      const { container } = render(
        <CoordinatorNames names={["Ravi", "Abhijith"]} variant="chips" className="mt-1" />,
      );
      expect(container.firstElementChild).toHaveClass("flex-wrap", "mt-1");
    });

    it("keeps two people with the same name apart", () => {
      render(<CoordinatorNames names={["Ravi Kumar", "Ravi Kumar"]} variant="chips" />);
      expect(screen.getAllByText("Ravi Kumar")).toHaveLength(2);
    });

    it("reads an empty team as an em dash, not as an empty row", () => {
      render(<CoordinatorNames names={[]} variant="chips" />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("drops blank names", () => {
      render(<CoordinatorNames names={["Ravi", " "]} variant="chips" />);
      expect(screen.getAllByText(/\S/)).toHaveLength(1);
    });
  });
});
