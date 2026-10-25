import { describe, expect, it } from "vitest";
import { readCoordinatorIds } from "./coordinators";

const RAHUL = "11111111-1111-4111-8111-111111111111";
const PRIYA = "22222222-2222-4222-8222-222222222222";
const ARUN = "33333333-3333-4333-8333-333333333333";

function form(entries: [string, string | File][]): FormData {
  const fd = new FormData();
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}

describe("readCoordinatorIds", () => {
  it("keeps the order the person arranged", () => {
    const fd = form([
      ["coordinator_ids", PRIYA],
      ["coordinator_ids", RAHUL],
      ["coordinator_ids", ARUN],
    ]);
    expect(readCoordinatorIds(fd)).toEqual([PRIYA, RAHUL, ARUN]);
  });

  it("is empty when the form names no one", () => {
    expect(readCoordinatorIds(new FormData())).toEqual([]);
    expect(readCoordinatorIds(form([["client_name", "Anand"]]))).toEqual([]);
  });

  it("drops duplicates, keeping the first, and anything that is not an id", () => {
    const fd = form([
      ["coordinator_ids", ` ${RAHUL} `],
      ["coordinator_ids", "someone-else"],
      ["coordinator_ids", ""],
      ["coordinator_ids", PRIYA],
      ["coordinator_ids", RAHUL.toUpperCase()],
      ["coordinator_ids", new File(["x"], "x.txt")],
    ]);
    expect(readCoordinatorIds(fd)).toEqual([RAHUL, PRIYA]);
  });

  it("reads another field when asked", () => {
    const fd = form([
      ["coordinator_ids", RAHUL],
      ["partners", PRIYA],
    ]);
    expect(readCoordinatorIds(fd, "partners")).toEqual([PRIYA]);
  });

  it("ignores the old single-coordinator field", () => {
    expect(readCoordinatorIds(form([["coordinator_id", RAHUL]]))).toEqual([]);
  });
});
