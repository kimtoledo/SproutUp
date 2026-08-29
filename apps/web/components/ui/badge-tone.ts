export type BadgeTone = 'neutral' | 'progress' | 'attention' | 'success' | 'danger';

/**
 * Maps a domain status string (onboarding case status, approval status, job
 * status, …) to a badge tone. Unknown values fall back to `neutral` so a new
 * server-side status never throws in the UI.
 */
const statusTones: Record<string, BadgeTone> = {
  // onboarding case status
  draft: 'neutral',
  submitted: 'progress',
  in_review: 'progress',
  needs_information: 'attention',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'danger',
  expired: 'danger',
  // approval / role-change lifecycle
  pending: 'progress',
  executed: 'success',
  cancelled: 'danger',
  // generic
  active: 'success',
  suspended: 'attention',
  failed: 'danger',
};

export function statusTone(status: string): BadgeTone {
  return statusTones[status] ?? 'neutral';
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-muted-foreground',
  progress: 'bg-info-subtle text-info-strong',
  attention: 'bg-warning-subtle text-warning-strong',
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger-strong',
};

export function badgeToneClasses(tone: BadgeTone): string {
  return toneClasses[tone];
}
