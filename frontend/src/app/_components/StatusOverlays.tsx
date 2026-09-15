import { X } from 'lucide-react';

interface StatusOverlaysProps {
  // Status flags
  isProcessing: boolean;      // Processing transcription after recording stops
  isSaving: boolean;          // Saving transcript to database

  // Layout
  sidebarCollapsed: boolean;  // For responsive margin calculation
  processingMessage?: string;
  savingMessage?: string;
  onCancelProcessing?: () => void;
  onViewMeeting?: () => void;
}

// Internal reusable component for individual status overlays
interface StatusOverlayProps {
  show: boolean;
  message: string;
  sidebarCollapsed: boolean;
  onCancel?: () => void;
  onViewMeeting?: () => void;
}

function StatusOverlay({ show, message, sidebarCollapsed, onCancel, onViewMeeting }: StatusOverlayProps) {
  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-0 right-0 z-40 pointer-events-none">
      <div
        className="flex justify-center pl-8 transition-[margin] duration-300"
        style={{
          marginLeft: sidebarCollapsed ? '4rem' : '16rem'
        }}
      >
        <div className="w-2/3 max-w-[750px] flex justify-center">
          <div className="pointer-events-auto bg-white rounded-lg shadow-lg px-4 py-2 flex items-center space-x-3">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
            <span className="text-sm text-gray-700">{message}</span>
            {onViewMeeting && (
              <button
                type="button"
                onClick={onViewMeeting}
                className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                View meeting
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="shrink-0 rounded-md p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                title="Cancel transcription"
                aria-label="Cancel transcription"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Main exported component - renders multiple status overlays
export function StatusOverlays({
  isProcessing,
  isSaving,
  sidebarCollapsed,
  processingMessage,
  savingMessage,
  onCancelProcessing,
  onViewMeeting
}: StatusOverlaysProps) {
  return (
    <>
      {/* Saving status overlay - shown first while the audio file / meeting is written */}
      <StatusOverlay
        show={isSaving}
        message={savingMessage || 'Saving audio file...'}
        sidebarCollapsed={sidebarCollapsed}
      />

      {/* Processing status overlay - shown after the file is saved while transcription runs */}
      {/* TODO: This overlay only exists on the home page. After leaving, progress is gone;
          keep a global % indicator (or a way back into the processing view) while transcription continues. */}
      <StatusOverlay
        show={isProcessing && !isSaving}
        message={processingMessage || 'File saved, starting transcription...'}
        sidebarCollapsed={sidebarCollapsed}
        onCancel={onCancelProcessing}
        onViewMeeting={onViewMeeting}
      />
    </>
  );
}
