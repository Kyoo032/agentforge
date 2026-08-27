import { describe, expect, it } from "vitest";
import { dayGroupLabel, groupThreadsByDay } from "./thread-groups";

describe("thread day groups", () => {
  const now = new Date(2026, 7, 27, 21, 0, 0);

  it("labels today, yesterday, and earlier", () => {
    expect(dayGroupLabel(new Date(2026, 7, 27, 8, 0, 0), now)).toBe("Today");
    expect(dayGroupLabel(new Date(2026, 7, 26, 23, 0, 0), now)).toBe("Yesterday");
    expect(dayGroupLabel(new Date(2026, 7, 20, 12, 0, 0), now)).toBe("Earlier");
  });

  it("omits empty groups and keeps order", () => {
    const groups = groupThreadsByDay(
      [
        { id: "a", createdAt: new Date(2026, 7, 27, 10, 0, 0) },
        { id: "b", createdAt: "2026-08-20T03:00:00.000Z" },
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual(["Today", "Earlier"]);
    expect(groups[0]?.threads).toHaveLength(1);
  });
});
