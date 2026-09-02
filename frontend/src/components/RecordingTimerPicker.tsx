'use client';

import { useEffect, useState } from 'react';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const PRESETS: { label: string; seconds: number | null }[] = [
  { label: 'Off', seconds: null },
  { label: '15m', seconds: 15 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '45m', seconds: 45 * 60 },
  { label: '60m', seconds: 60 * 60 },
];

const CUSTOM_MIN_MINUTES = 1;
const CUSTOM_MAX_MINUTES = 480;

function isPresetSeconds(seconds: number | null): boolean {
  return PRESETS.some((p) => p.seconds === seconds);
}

export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Idle-state duration picker for optional auto-stop timer.
 */
export function RecordingTimerPicker() {
  const { maxDurationSeconds, setMaxDurationSeconds } = useRecordingState();
  const [isCustom, setIsCustom] = useState(
    () => maxDurationSeconds !== null && !isPresetSeconds(maxDurationSeconds)
  );
  const [customMinutes, setCustomMinutes] = useState(() =>
    maxDurationSeconds !== null && !isPresetSeconds(maxDurationSeconds)
      ? Math.max(CUSTOM_MIN_MINUTES, Math.round(maxDurationSeconds / 60))
      : 5
  );

  // Keep custom UI in sync when preference hydrates from localStorage
  useEffect(() => {
    if (maxDurationSeconds !== null && !isPresetSeconds(maxDurationSeconds)) {
      setIsCustom(true);
      setCustomMinutes(Math.max(CUSTOM_MIN_MINUTES, Math.round(maxDurationSeconds / 60)));
    } else if (isPresetSeconds(maxDurationSeconds)) {
      setIsCustom(false);
    }
  }, [maxDurationSeconds]);

  const applyCustomMinutes = (minutes: number) => {
    const clamped = Math.min(
      CUSTOM_MAX_MINUTES,
      Math.max(CUSTOM_MIN_MINUTES, Math.floor(minutes) || CUSTOM_MIN_MINUTES)
    );
    setCustomMinutes(clamped);
    setMaxDurationSeconds(clamped * 60);
  };

  return (
    <div className="flex items-center gap-1.5 mr-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-gray-500 whitespace-nowrap select-none">Timer</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>Auto-stop after this duration (pauses freeze the timer)</p>
        </TooltipContent>
      </Tooltip>
      <div className="flex items-center rounded-full bg-gray-100 p-0.5">
        {PRESETS.map((preset) => {
          const selected = !isCustom && maxDurationSeconds === preset.seconds;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setIsCustom(false);
                setMaxDurationSeconds(preset.seconds);
              }}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                selected
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setIsCustom(true);
            applyCustomMinutes(customMinutes);
          }}
          className={`px-2 py-1 text-xs rounded-full transition-colors ${
            isCustom
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Custom
        </button>
      </div>
      {isCustom && (
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="number"
            min={CUSTOM_MIN_MINUTES}
            max={CUSTOM_MAX_MINUTES}
            value={customMinutes}
            onChange={(e) => applyCustomMinutes(Number(e.target.value))}
            className="w-14 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-800"
            aria-label="Custom timer minutes"
          />
          <span>min</span>
        </label>
      )}
    </div>
  );
}

/**
 * Live countdown shown while recording with a timer limit.
 */
export function RecordingTimerCountdown() {
  const { remainingSeconds, isPaused } = useRecordingState();

  if (remainingSeconds === null) return null;

  const colorClass =
    remainingSeconds <= 10
      ? 'text-red-600'
      : remainingSeconds <= 60
        ? 'text-amber-600'
        : 'text-gray-700';

  return (
    <div
      className={`mx-2 min-w-[3.25rem] text-center text-sm font-medium tabular-nums ${colorClass} ${
        isPaused ? 'opacity-60' : ''
      }`}
      title={isPaused ? 'Timer paused' : 'Time remaining'}
      aria-live="polite"
    >
      {formatCountdown(remainingSeconds)}
    </div>
  );
}
