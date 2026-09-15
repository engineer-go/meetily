'use client';

import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';

interface RetranscriptionProgress {
  meeting_id: string;
  stage: string;
  progress_percentage: number;
  message: string;
}

interface PostSaveTranscriptionBannerProps {
  meetingId: string;
  active: boolean;
  onComplete: () => void;
}

type BannerState =
  | { kind: 'hidden' }
  | { kind: 'running'; message: string; percent: number }
  | { kind: 'cancelling'; percent: number }
  | { kind: 'cancelled' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

function isCancellationMessage(message: string): boolean {
  return message.toLowerCase().includes('cancelled');
}

// TODO: Progress is local to this mount + `transcribing` query. Navigating away unmounts it
// and looks like transcription finished. Rehydrate from backend (`is_retranscription_in_progress`)
// and keep % visible globally so the user can return to the meeting while it still runs.
export function PostSaveTranscriptionBanner({
  meetingId,
  active,
  onComplete,
}: PostSaveTranscriptionBannerProps) {
  const [state, setState] = useState<BannerState>(
    active
      ? { kind: 'running', message: 'File saved, starting transcription...', percent: 0 }
      : { kind: 'hidden' }
  );
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const sawProgressRef = useRef(false);

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      unlisteners.push(
        await listen<RetranscriptionProgress>('retranscription-progress', (event) => {
          if (event.payload.meeting_id !== meetingId) {
            return;
          }
          sawProgressRef.current = true;
          setState((prev) => {
            if (prev.kind === 'cancelling' || prev.kind === 'cancelled' || prev.kind === 'hidden') {
              return prev;
            }
            return {
              kind: 'running',
              message: event.payload.message || 'Transcribing audio...',
              percent: event.payload.progress_percentage,
            };
          });
        })
      );

      unlisteners.push(
        await listen<{ meeting_id: string }>('retranscription-complete', (event) => {
          if (event.payload.meeting_id !== meetingId) {
            return;
          }
          setState((prev) => {
            if (prev.kind === 'hidden' || prev.kind === 'cancelled') {
              return prev;
            }
            onCompleteRef.current();
            return { kind: 'done' };
          });
        })
      );

      unlisteners.push(
        await listen<{ meeting_id: string; error: string }>('retranscription-error', (event) => {
          if (event.payload.meeting_id !== meetingId) {
            return;
          }
          setState((prev) => {
            if (prev.kind === 'hidden' || prev.kind === 'cancelled') {
              return prev;
            }
            if (isCancellationMessage(event.payload.error)) {
              toast.info('Transcription cancelled', {
                description: 'The audio file is saved.',
              });
              onCompleteRef.current();
              return { kind: 'cancelled' };
            }
            return { kind: 'error', message: event.payload.error };
          });
        })
      );

      if (cancelled) {
        return;
      }

      const inProgress = await invoke<boolean>('is_retranscription_in_progress_command');
      if (!cancelled && inProgress) {
        setState((prev) =>
          prev.kind === 'running' || prev.kind === 'cancelling' || prev.kind === 'cancelled'
            ? prev
            : { kind: 'running', message: 'File saved, transcribing audio...', percent: 0 }
        );
      }
    };

    void setup();

    const poll = window.setInterval(async () => {
      if (!sawProgressRef.current) {
        return;
      }
      try {
        const inProgress = await invoke<boolean>('is_retranscription_in_progress_command');
        if (!inProgress) {
          setState((prev) => {
            if (prev.kind === 'running') {
              onCompleteRef.current();
              return { kind: 'done' };
            }
            return prev;
          });
        }
      } catch {
        // ignore poll errors
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [active, meetingId]);

  const handleCancel = () => {
    setState({ kind: 'hidden' });
    onCompleteRef.current();
    toast.info('Transcription cancelled', {
      description: 'The audio file is saved.',
    });
    void invoke('cancel_retranscription_command').catch((error) => {
      console.error('Failed to cancel transcription:', error);
    });
  };

  const handleDismiss = () => {
    setState({ kind: 'hidden' });
    onCompleteRef.current();
  };

  if (state.kind === 'hidden' || state.kind === 'cancelled') {
    return null;
  }

  if (!active && (state.kind === 'running' || state.kind === 'cancelling')) {
    return null;
  }

  if (state.kind === 'done') {
    return (
      <div className="mx-6 mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
        <div className="flex-1 text-sm text-green-800">
          <div className="font-medium">File saved</div>
          <div>Transcription finished.</div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded-md p-1 text-green-700 hover:bg-green-100"
          title="Dismiss"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
        <div className="flex-1 text-sm text-red-800">
          <div className="font-medium">File saved, transcription failed</div>
          <div>{state.message}</div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded-md p-1 text-red-700 hover:bg-red-100"
          title="Dismiss"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const isCancelling = state.kind === 'cancelling';
  const percent = state.kind === 'running' || state.kind === 'cancelling' ? state.percent : 0;
  const message = isCancelling
    ? 'Cancelling after the current segment…'
    : state.kind === 'running'
      ? state.message
      : '';

  return (
    <div className="mx-6 mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-center gap-3">
      <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-blue-900">
          {isCancelling ? 'Cancelling transcription' : 'File saved, starting transcription'}
        </div>
        <div className="text-sm text-blue-700 truncate">{message}</div>
        <div className="mt-2 h-1.5 rounded-full bg-blue-100 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      </div>
      <div className="text-xs font-medium text-blue-700 tabular-nums">{percent}%</div>
      <button
        type="button"
        onClick={handleCancel}
        className="shrink-0 rounded-md p-1 text-blue-700 hover:bg-blue-100 hover:text-blue-900"
        title="Cancel transcription"
        aria-label="Cancel transcription"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
