/**
 * Build and open the meeting-details URL.
 *
 * Next.js `output: 'export'` plus the Tauri webview can drop
 * client navigations from `router.push`. A full assign is reliable.
 */
export function meetingDetailsHref(
  meetingId: string,
  options?: { source?: string; transcribing?: boolean }
): string {
  const params = new URLSearchParams({ id: meetingId });
  if (options?.source) {
    params.set('source', options.source);
  }
  if (options?.transcribing) {
    params.set('transcribing', '1');
  }
  return `/meeting-details?${params.toString()}`;
}

export function isHomePath(pathname?: string | null): boolean {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  return path === '/' || path === '/index.html' || path === '';
}

export function openHome(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (isHomePath()) {
    return;
  }
  window.location.assign('/');
}

export function openMeetingDetails(
  meetingId: string,
  options?: { source?: string; transcribing?: boolean }
): void {
  if (typeof window === 'undefined' || !meetingId) {
    return;
  }
  window.location.assign(meetingDetailsHref(meetingId, options));
}
