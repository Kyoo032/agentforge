import { describe, expect, it } from "vitest";
import {
  animateStoryboardSchema,
  generateStoryboardSchema,
  imageAspectForEdit,
  splitSceneToShots,
} from "./storyboard";

describe("storyboard tool schemas", () => {
  it("accepts generate_storyboard args with 4 or 6 shots", () => {
    expect(
      generateStoryboardSchema.parse({
        scene: "Opening wide.\nHero close-up.\nProduct detail.\nLogo end card.",
        shots: 4,
        aspect: "16:9",
        tier: "standard",
      }),
    ).toMatchObject({ shots: 4, aspect: "16:9" });
    expect(
      generateStoryboardSchema.parse({
        scene: "One continuous paragraph describing six beats for the ad.",
        shots: 6,
        aspect: "9:16",
        tier: "draft",
        ingredientIds: ["ref-logo"],
      }),
    ).toMatchObject({ shots: 6, ingredientIds: ["ref-logo"] });
  });

  it("rejects invalid shot counts and empty scenes", () => {
    expect(() =>
      generateStoryboardSchema.parse({
        scene: "",
        shots: 4,
        aspect: "16:9",
        tier: "standard",
      }),
    ).toThrow();
    expect(() =>
      generateStoryboardSchema.parse({
        scene: "Valid scene",
        shots: 5,
        aspect: "16:9",
        tier: "standard",
      }),
    ).toThrow();
  });

  it("accepts animate_storyboard clip id lists", () => {
    expect(
      animateStoryboardSchema.parse({
        clipIds: ["clip-a", "clip-b"],
        tier: "cinematic",
      }),
    ).toMatchObject({ clipIds: ["clip-a", "clip-b"], tier: "cinematic" });
    expect(() => animateStoryboardSchema.parse({ clipIds: [] })).toThrow();
  });

  it("splits scenes into the requested number of prompts", () => {
    expect(splitSceneToShots("A\nB\nC\nD", 4)).toEqual(["A", "B", "C", "D"]);
    expect(splitSceneToShots("Single block of text for six shots", 6)).toHaveLength(6);
    expect(imageAspectForEdit("16:9")).toBe("landscape");
    expect(imageAspectForEdit("9:16")).toBe("portrait");
    expect(imageAspectForEdit("1:1")).toBe("square");
  });
});
