export type StepState = 'done' | 'current' | 'upcoming';

export interface StepView {
  label: string;
  state: StepState;
  /** 1-based number shown in the marker. */
  position: number;
}

/**
 * Given ordered step labels and the active index, return the per-step display
 * state for a progress stepper. `currentIndex` is clamped into range so an
 * out-of-bounds value from a resumed multi-step form cannot desync the UI.
 */
export function stepStates(labels: readonly string[], currentIndex: number): StepView[] {
  const clamped = Math.max(0, Math.min(currentIndex, Math.max(labels.length - 1, 0)));
  return labels.map((label, index) => ({
    label,
    position: index + 1,
    state: index < clamped ? 'done' : index === clamped ? 'current' : 'upcoming',
  }));
}

/** Fraction (0–1) of steps completed, for an accompanying progress bar. */
export function stepProgress(labels: readonly string[], currentIndex: number): number {
  if (labels.length <= 1) return currentIndex > 0 ? 1 : 0;
  const clamped = Math.max(0, Math.min(currentIndex, labels.length - 1));
  return clamped / (labels.length - 1);
}
