import { describe, expect, it } from "vitest";
import { resolutionOptionsForCamera } from "./config";

describe("resolutionOptionsForCamera", () => {
  it("keeps only the options the camera can deliver", () => {
    expect(resolutionOptionsForCamera(2560, 1440).map((option) => option.size)).toEqual([
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]);
  });

  it("throws for a camera below Full HD", () => {
    expect(() => resolutionOptionsForCamera(1280, 720)).toThrow(/No supported resolution/);
  });
});
