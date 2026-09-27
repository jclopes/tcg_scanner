import { describe, expect, it } from "vitest";
import { CAMERA_RESOLUTION_OPTIONS, resolutionOptionsForCamera } from "./config";

describe("resolutionOptionsForCamera", () => {
  it("keeps only the options the camera can deliver", () => {
    expect(resolutionOptionsForCamera(2560, 1440).map((option) => option.size)).toEqual([
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]);
  });

  it("offers every option to a 4K camera", () => {
    expect(resolutionOptionsForCamera(3840, 2160)).toEqual(CAMERA_RESOLUTION_OPTIONS);
  });

  it("throws for a camera below Full HD", () => {
    expect(() => resolutionOptionsForCamera(1280, 720)).toThrow(/No supported resolution/);
  });
});
