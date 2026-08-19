'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck, RefreshCw, Sprout } from 'lucide-react';
import {
  loadAdminOnboardingCaseDetail,
  loadAdminOnboardingWorkspace,
  rejectOnboardingCase,
  requestOnboardingInformation,
  startOnboardingReview,
  type AdminOnboardingCase,
  type AdminOnboardingCaseDetail,
  type AdminQueueFilters,
  type AdminWorkspaceResult,
} from '@/lib/admin-onboarding-client';
import type { CaseStatus, CaseType } from '@/lib/portal-client';
import { product } from '@/lib/product';

const statuses: CaseStatus[] = [
  'draft', 'submitted', 'in_review', 'needs_information',
  'approved', 'rejected', 'withdrawn', 'expired',
];
const eventLabels: Record<string, string> = {
  created: 'Case started',
  submitted: 'Submitted for review',
  review_started: 'Review started',
  information_requested: 'More information requested',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  reopened: 'Reopened',
  expired: 'Expired',
};

export default function AdminOnboardingPage() {
  const [filters, setFilters] = useState<AdminQueueFilters>({ page: 1, pageSize: 25 });
  const [state, setState] = useState<AdminWorkspaceResult | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reasonCase, setReasonCase] = useState<{
    id: string;
    action: 'information' | 'reject';
  } | null>(null);
  const [detail, setDetail] = useState<AdminOnboardingCaseDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const refresh = useCallback(async (nextFilters: AdminQueueFilters = filters) => {
    setState(await loadAdminOnboardingWorkspace(nextFilters));
  }, [filters]);

  useEffect(() => {
    let active = true;
    void loadAdminOnboardingWorkspace(filters).then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, [filters]);

  async function run(
    caseId: string,
    action: () => Promise<{ ok: boolean; message?: string; unauthenticated?: boolean }>,
  ) {
    if (pending) return;
    setPending(caseId);
    setMessage(null);
    const result = await action();
    if (!result.ok) {
      setMessage(result.message ?? 'The review action could not be completed.');
      if (result.unauthenticated) setState({ ok: false, reason: 'unauthenticated' });
    } else {
      setReasonCase(null);
    }
    await refresh();
    setPending(null);
  }

  async function toggleDetail(caseId: string) {
    if (detail?.id === caseId) {
      setDetail(null);
      return;
    }
    if (detailLoadingId) return;
    setDetailLoadingId(caseId);
    setMessage(null);
    const result = await loadAdminOnboardingCaseDetail(caseId);
    if (result.ok) {
      setDetail(result.detail);
    } else {
      setMessage(result.message);
      if (result.unauthenticated) setState({ ok: false, reason: 'unauthenticated' });
    }
    setDetailLoadingId(null);
  }

  function updateFilters(changes: Partial<AdminQueueFilters>) {
    setState(null);
    setFilters((current) => ({ ...current, ...changes, page: changes.page ?? 1 }));
  }

  if (!state) {
    return <AdminState title="Loading compliance queue…" detail="Resolving staff permissions and current work." />;
  }
  if (!state.ok) {
    const title = state.reason === 'unauthenticated'
      ? 'Staff sign-in is required.'
      : state.reason === 'forbidden'
        ? 'This queue is not available to your role.'
        : 'The queue is temporarily unavailable.';
    return (
      <AdminState title={title} detail="No compliance case data was displayed.">
        <Link href={state.reason === 'unauthenticated' ? '/login' : '/portal'} className="primary-action">
          Continue safely
        </Link>
      </AdminState>
    );
  }

  const canReview = state.session.permissions.includes('onboarding_cases.review');
  const pages = Math.max(1, Math.ceil(state.queue.total / state.queue.pageSize));
  return (
    <main className="admin-page">
      <header className="admin-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true"><Sprout size={18} /></span>
          {product.name} <small>Operations</small>
        </Link>
        <Link className="quiet-link" href="/portal">Customer portal</Link>
      </header>

      <section className="admin-intro">
        <div>
          <p className="eyebrow">Compliance workspace</p>
          <h1>Onboarding review queue</h1>
          <p>Signed in as {state.session.user.email}. Every action is re-authorized and version checked.</p>
        </div>
        <div className="queue-count"><strong>{state.queue.total}</strong><span>matching cases</span></div>
      </section>

      <section className="queue-panel">
        <div className="queue-filters" aria-label="Queue filters">
          <label>Journey
            <select
              value={filters.caseType ?? ''}
              onChange={(event) => updateFilters({
                caseType: (event.target.value || undefined) as CaseType | undefined,
              })}
            >
              <option value="">All journeys</option>
              <option value="borrower">Borrower</option>
              <option value="investor">Investor</option>
            </select>
          </label>
          <label>Status
            <select
              value={filters.status ?? ''}
              onChange={(event) => updateFilters({
                status: (event.target.value || undefined) as CaseStatus | undefined,
              })}
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option value={status} key={status}>{status.replaceAll('_', ' ')}</option>
              ))}
            </select>
          </label>
          <label className="check-filter">
            <input
              checked={filters.assignedToMe ?? false}
              onChange={(event) => updateFilters({ assignedToMe: event.target.checked || undefined })}
              type="checkbox"
            /> Assigned to me
          </label>
          <button className="quiet-button" onClick={() => void refresh()} type="button">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {message ? <p className="form-message" role="alert">{message}</p> : null}
        {state.queue.cases.length === 0 ? (
          <div className="empty-state"><h3>No matching cases</h3><p>Adjust the filters or refresh after new submissions arrive.</p></div>
        ) : (
          <div className="admin-case-list">
            {state.queue.cases.map((item) => (
              <AdminCaseCard
                canReview={canReview}
                currentUserId={state.session.user.id}
                detail={detail?.id === item.id ? detail : null}
                detailLoading={detailLoadingId === item.id}
                item={item}
                key={item.id}
                pending={pending === item.id}
                reasonAction={reasonCase?.id === item.id ? reasonCase.action : null}
                onReasonAction={(action) => setReasonCase(
                  reasonCase?.id === item.id && reasonCase.action === action
                    ? null
                    : { id: item.id, action },
                )}
                onRun={(action) => void run(item.id, action)}
                onToggleDetail={() => void toggleDetail(item.id)}
              />
            ))}
          </div>
        )}

        <div className="pagination" aria-label="Queue pages">
          <button
            disabled={filters.page <= 1}
            onClick={() => updateFilters({ page: filters.page - 1 })}
            type="button"
          ><ChevronLeft size={16} /> Previous</button>
          <span>Page {state.queue.page} of {pages}</span>
          <button
            disabled={filters.page >= pages}
            onClick={() => updateFilters({ page: filters.page + 1 })}
            type="button"
          >Next <ChevronRight size={16} /></button>
        </div>
      </section>
    </main>
  );
}

function AdminCaseCard({
  item,
  currentUserId,
  canReview,
  detail,
  detailLoading,
  pending,
  reasonAction,
  onReasonAction,
  onRun,
  onToggleDetail,
}: {
  item: AdminOnboardingCase;
  currentUserId: string;
  canReview: boolean;
  detail: AdminOnboardingCaseDetail | null;
  detailLoading: boolean;
  pending: boolean;
  reasonAction: 'information' | 'reject' | null;
  onReasonAction(action: 'information' | 'reject'): void;
  onRun(action: () => Promise<{ ok: boolean; message?: string; unauthenticated?: boolean }>): void;
  onToggleDetail(): void;
}) {
  const assignedToMe = item.assignedReviewerUserId === currentUserId;
  function submitReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    onRun(() => reasonAction === 'information'
      ? requestOnboardingInformation(item.id, item.version, reason)
      : rejectOnboardingCase(item.id, item.version, reason));
  }
  return (
    <article className="admin-case-card">
      <div className="admin-case-main">
        <div className="journey-icon"><ClipboardCheck size={20} /></div>
        <div><strong>{item.applicantName}</strong><span>{item.applicantEmail}</span></div>
        <span className={`case-status status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span>
        <small>{item.caseType} · v{item.version}</small>
      </div>
      <div className="admin-case-actions">
        <button
          className="text-button"
          disabled={detailLoading}
          onClick={onToggleDetail}
          type="button"
        >
          {detailLoading ? 'Loading history…' : detail ? 'Hide history' : 'View history'}
        </button>
        {canReview && item.status === 'submitted' && (!item.assignedReviewerUserId || assignedToMe) ? (
          <button
            className="compact-action button-reset"
            disabled={pending}
            onClick={() => onRun(() => startOnboardingReview(item.id, item.version))}
            type="button"
          >{pending ? 'Saving…' : assignedToMe ? 'Resume review' : 'Claim review'}</button>
        ) : null}
        {canReview && item.status === 'in_review' && assignedToMe ? (
          <>
            <button className="text-button" onClick={() => onReasonAction('information')} type="button">Request information</button>
            <button className="text-button danger-text" onClick={() => onReasonAction('reject')} type="button">Reject</button>
          </>
        ) : null}
        {item.assignedReviewerUserId && !assignedToMe ? (
          <span className="assigned-note">Assigned to another reviewer</span>
        ) : null}
      </div>
      {reasonAction ? (
        <form className="review-reason-form" onSubmit={submitReason}>
          <label>
            {reasonAction === 'information' ? 'Information request reason' : 'Rejection reason'}
            <textarea minLength={10} maxLength={1000} name="reason" required />
          </label>
          <button
            className={reasonAction === 'reject' ? 'danger-action' : 'compact-action button-reset'}
            disabled={pending}
            type="submit"
          >{pending ? 'Saving…' : reasonAction === 'information' ? 'Send request' : 'Confirm rejection'}</button>
        </form>
      ) : null}
      {detail ? (
        <section className="case-timeline" aria-label={`${item.caseType} case history`}>
          <h3>Case history</h3>
          <ol>
            {detail.events.map((event) => (
              <li key={event.id}>
                <span className="timeline-marker" aria-hidden="true" />
                <div>
                  <strong>{eventLabels[event.eventType] ?? event.eventType.replaceAll('_', ' ')}</strong>
                  <small>
                    {new Date(event.occurredAt).toLocaleString('en-PH')} · Version {event.caseVersion}
                  </small>
                  {event.reason ? <p>{event.reason}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

function AdminState({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <main className="portal-state">
      <span className="brand-mark"><ClipboardCheck size={18} /></span>
      <h1>{title}</h1><p>{detail}</p>{children}
    </main>
  );
}
