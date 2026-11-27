export type GuidedTourTimeoutScheduler = Pick<Window, 'setTimeout' | 'clearTimeout'>;

export function scheduleGuidedTour(
  startTour: () => void,
  scheduler: GuidedTourTimeoutScheduler = window
): () => void {
  const timeoutId = scheduler.setTimeout(startTour, 1500);
  return () => scheduler.clearTimeout(timeoutId);
}
