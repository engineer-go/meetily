import { describe, expect, test } from "bun:test";
import { formatCountdown } from "../../src/components/RecordingTimerPicker";

describe("formatCountdown", () => {
  test("formats under one hour as M:SS", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(60 * 15)).toBe("15:00");
  });

  test("formats one hour and above as H:MM:SS", () => {
    expect(formatCountdown(3600)).toBe("1:00:00");
    expect(formatCountdown(3661)).toBe("1:01:01");
  });

  test("clamps negative values to zero", () => {
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("remainingSeconds derivation", () => {
  function remainingSeconds(
    isRecording: boolean,
    maxDurationSeconds: number | null,
    activeDuration: number | null
  ): number | null {
    if (!isRecording || maxDurationSeconds === null) {
      return null;
    }
    const elapsed = activeDuration ?? 0;
    return Math.max(0, maxDurationSeconds - elapsed);
  }

  test("Off yields null", () => {
    expect(remainingSeconds(true, null, 10)).toBeNull();
  });

  test("idle yields null even with a limit", () => {
    expect(remainingSeconds(false, 60, 0)).toBeNull();
  });

  test("counts down using active duration (pause-aware)", () => {
    expect(remainingSeconds(true, 60, 15)).toBe(45);
    expect(remainingSeconds(true, 60, 60)).toBe(0);
    expect(remainingSeconds(true, 60, 90)).toBe(0);
  });

  test("treats null activeDuration as zero elapsed", () => {
    expect(remainingSeconds(true, 120, null)).toBe(120);
  });
});
