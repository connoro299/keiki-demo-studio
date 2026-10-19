import { describe, expect, it } from "vitest";
import { typingDotPose } from "@/renderers/ios/cues";
import { typingLoopMs, typingStaggerMs } from "@/components/imessage/typing-indicator";

describe("typingDotPose", () => {
  it("rests, peaks at 30% of the loop, and returns to rest", () => {
    expect(typingDotPose(0, 0).opacity).toBeCloseTo(0.35);
    expect(typingDotPose(0, typingLoopMs * 0.3).opacity).toBeCloseTo(1);
    expect(typingDotPose(0, typingLoopMs * 0.8).opacity).toBeCloseTo(0.35);
  });
  it("is periodic and staggers dots", () => {
    expect(typingDotPose(1, 123 + typingLoopMs)).toEqual(typingDotPose(1, 123));
    expect(typingDotPose(1, 300 + typingStaggerMs)).toEqual(typingDotPose(0, 300));
  });
  it("changes across export frames so a seek-driven video animates", () => {
    const poses = new Set(Array.from({ length: 36 }, (_, i) => typingDotPose(0, (i * 1000) / 30).opacity.toFixed(3)));
    expect(poses.size).toBeGreaterThan(10);
  });
});
