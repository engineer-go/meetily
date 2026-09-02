'use client';

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { toast } from 'sonner';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import Analytics from '@/lib/analytics';

/**
 * Auto-stops an active recording when the user-configured duration elapses.
 * Uses activeDuration (pause-aware) from RecordingStateContext.
 * Invokes the same stop_recording + post-processing path as the Stop button.
 */
export function useRecordingAutoStop(
  onRecordingStop: (callApi: boolean) => void | Promise<void>,
  onStopInitiated?: () => void
): void {
  const {
    isRecording,
    remainingSeconds,
    maxDurationSeconds,
    status,
  } = useRecordingState();

  const firedForSessionRef = useRef(false);
  const stoppingRef = useRef(false);
  const onRecordingStopRef = useRef(onRecordingStop);
  const onStopInitiatedRef = useRef(onStopInitiated);

  useEffect(() => {
    onRecordingStopRef.current = onRecordingStop;
  }, [onRecordingStop]);

  useEffect(() => {
    onStopInitiatedRef.current = onStopInitiated;
  }, [onStopInitiated]);

  // Reset one-shot guard when a new recording session begins
  useEffect(() => {
    if (isRecording) {
      firedForSessionRef.current = false;
      stoppingRef.current = false;
    }
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording || maxDurationSeconds === null) return;
    if (remainingSeconds === null || remainingSeconds > 0) return;
    if (firedForSessionRef.current || stoppingRef.current) return;
    if (
      status === RecordingStatus.STOPPING ||
      status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
      status === RecordingStatus.SAVING
    ) {
      return;
    }

    firedForSessionRef.current = true;
    stoppingRef.current = true;

    const stopFromTimer = async () => {
      console.log('[useRecordingAutoStop] Timer reached — auto-stopping recording');
      Analytics.trackButtonClick('stop_recording_timer', 'recording_timer');
      onStopInitiatedRef.current?.();

      try {
        const dataDir = await appDataDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const savePath = `${dataDir}/recording-${timestamp}.wav`;

        await invoke('stop_recording', {
          args: { save_path: savePath },
        });

        toast.info('Recording stopped — timer reached.');
        onRecordingStopRef.current(true);
      } catch (error) {
        console.error('[useRecordingAutoStop] Failed to auto-stop recording:', error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('No recording in progress')) {
          onRecordingStopRef.current(false);
          return;
        }
        toast.error('Failed to stop recording when timer ended');
        onRecordingStopRef.current(false);
      } finally {
        stoppingRef.current = false;
      }
    };

    void stopFromTimer();
  }, [isRecording, maxDurationSeconds, remainingSeconds, status]);
}
