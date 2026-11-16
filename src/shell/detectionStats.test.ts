import { describe, expect, it } from "vitest";
import { applyDetectionStatEvent, emptyDetectionStats, parseDetectionStats } from "./detectionStats";
import type { DetectionStats } from "./detectionStats";

describe("applyDetectionStatEvent", () => {
  it("starts an unsplit metric's bucket at 1 and increments it on repeat, without touching other metrics", () => {
    const first = applyDetectionStatEvent(emptyDetectionStats(), { metric: "outcomes", value: "captured" });
    expect(first.outcomes).toEqual({ captured: 1 });

    const second = applyDetectionStatEvent(first, { metric: "outcomes", value: "captured" });
    expect(second.outcomes).toEqual({ captured: 2 });
    expect(second.spikeCount.captured).toEqual({});
  });

  it("floors a numeric value to its bucket label", () => {
    const stats = applyDetectionStatEvent(emptyDetectionStats(), { metric: "spikeCount", outcome: "captured", value: 3.7 });
    expect(stats.spikeCount.captured).toEqual({ "3": 1 });
  });

  it("keeps a split metric's outcomes apart, each with its own bucket histogram", () => {
    const withCaptured = applyDetectionStatEvent(emptyDetectionStats(), { metric: "spikeCount", outcome: "captured", value: 2 });
    const stats = applyDetectionStatEvent(withCaptured, { metric: "spikeCount", outcome: "rescan-number-not-confident", value: 2 });
    expect(stats.spikeCount).toEqual({
      captured: { "2": 1 },
      "rescan-set-unreadable": {},
      "rescan-number-not-confident": { "2": 1 },
    });
  });

  it("does not mutate the stats it was given", () => {
    const before = emptyDetectionStats();
    applyDetectionStatEvent(before, { metric: "outcomes", value: "captured" });
    expect(before.outcomes).toEqual({});
  });
});

describe("parseDetectionStats", () => {
  it("round-trips a saved DetectionStats", () => {
    const stats: DetectionStats = {
      outcomes: { captured: 3, "rescan-set-unreadable": 1 },
      burstFrameChosen: { captured: { "1": 4, "2": 2 }, "rescan-set-unreadable": {}, "rescan-number-not-confident": {} },
      spikeCount: { captured: { "3": 2 }, "rescan-set-unreadable": {}, "rescan-number-not-confident": { "1": 1 } },
      rowConfidenceRatio: { captured: { "2": 1, "5": 3 }, "rescan-set-unreadable": {}, "rescan-number-not-confident": {} },
      centerGrowthMerges: { captured: { "0": 2, "1": 1 }, "rescan-set-unreadable": {}, "rescan-number-not-confident": {} },
      ocrConfidence: { captured: { "90": 3 }, "rescan-set-unreadable": { "40": 1 }, "rescan-number-not-confident": {} },
      ocrVsAcceptedDistance: { "0": 5 },
    };
    expect(parseDetectionStats(JSON.stringify(stats))).toEqual(stats);
  });

  it("throws, naming the field, for a stored value missing a metric", () => {
    const { outcomes: _outcomes, ...withoutOutcomes } = emptyDetectionStats();
    expect(() => parseDetectionStats(JSON.stringify(withoutOutcomes))).toThrow(/"outcomes"/);
  });

  it("throws for a split metric missing one of its outcomes", () => {
    const { captured: _captured, ...withoutCaptured } = emptyDetectionStats().spikeCount;
    const stats = { ...emptyDetectionStats(), spikeCount: withoutCaptured };
    expect(() => parseDetectionStats(JSON.stringify(stats))).toThrow(/"spikeCount": "captured"/);
  });

  it("throws for a histogram whose bucket count isn't a number", () => {
    const stats = { ...emptyDetectionStats(), ocrVsAcceptedDistance: { "3": "two" } };
    expect(() => parseDetectionStats(JSON.stringify(stats))).toThrow(/"ocrVsAcceptedDistance"/);
  });

  it("throws for a stored value that isn't an object", () => {
    expect(() => parseDetectionStats(JSON.stringify([1, 2, 3]))).toThrow(/must be an object/);
  });
});
