'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Building2, LogOut, RefreshCw, Sprout, TrendingUp } from 'lucide-react';
import {
  createOnboardingCase,
  loadPortal,
  loadPortalCaseDetail,
  signOut,
  submitOnboardingCase,
  withdrawOnboardingCase,
  type CaseType,
  type PortalCase,
  type PortalCaseDetail,
  type PortalLoadResult,
} from '@/lib/portal-client';
import { product } from '@/lib/product';

const openStatuses = new Set(['draft', 'submitted', 'in_review', 'needs_information']);
const statusLabels: Record<PortalCase['status'], string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In review',
  needs_information: 'Needs information',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};
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

export default function PortalPage() {
  const [state, setState] = useState<PortalLoadResult | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [withdrawCaseId, setWithdrawCaseId] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [detail, setDetail] = useState<PortalCaseDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState(await loadPortal());
  }, []);

  useEffect(() => {
    let active = true;
    void loadPortal().then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, []);

  async function runAction(key: string, action: () => Promise<{ ok: boolean; message?: string; unauthenticated?: boolean }>) {
    if (pendingAction) return;
    setPendingAction(key);
    setMessage(null);
    const result = await action();
    if (!result.ok) {
      setMessage(result.message ?? 'The action could not be completed.');
      if (result.unauthenticated) setState({ ok: false, reason: 'unauthenticated' });
    } else {
      setWithdrawCaseId(null);
      setWithdrawReason('');
    }
    await refresh();
    setPendingAction(null);
  }

  async function toggleDetail(caseId: string) {
    if (detail?.id === caseId) {
      setDetail(null);
      return;
    }
    if (detailLoadingId) return;
    setDetailLoadingId(caseId);
    setMessage(null);
    const result = await loadPortalCaseDetail(caseId);
    if (result.ok) {
      setDetail(result.detail);
    } else {
      setMessage(result.message);
      if (result.unauthenticated) setState({ ok: false, reason: 'unauthenticated' });
    }
    setDetailLoadingId(null);
  }

  if (!state) {
    return <PortalState title="Loading your secure portal…" detail="Resolving your session and permissions." />;
  }
  if (!state.ok) {
    return (
      <PortalState
        title={state.reason === 'unauthenticated' ? 'Your session is required.' : 'The portal is temporarily unavailable.'}
        detail={state.reason === 'unauthenticated'
          ? 'Sign in to continue to your borrower or investor journey.'
          : 'No account data was loaded. Please retry in a moment.'}
      >
        {state.reason === 'unauthenticated' ? (
          <Link className="primary-action" href="/login">Sign in <ArrowRight size={18} /></Link>
        ) : (
          <button className="primary-action button-reset" onClick={() => void refresh()} type="button">
            Retry <RefreshCw size={17} />
          </button>
        )}
      </PortalState>
    );
  }

  const canManageBorrower = state.session.permissions.includes('borrower_onboarding.manage_own');
  const canManageInvestor = state.session.permissions.includes('investor_onboarding.manage_own');
  const canSubmitBorrower = state.session.permissions.includes('borrower_onboarding.submit_own');
  const canSubmitInvestor = state.session.permissions.includes('investor_onboarding.submit_own');

  return (
    <main className="portal-page">
      <header className="portal-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true"><Sprout size={18} /></span>
          {product.name}
        </Link>
        <button className="quiet-button" type="button" onClick={() => void signOut().then(() => setState({ ok: false, reason: 'unauthenticated' }))}>
          <LogOut aria-hidden="true" size={17} /> Sign out
        </button>
      </header>

      <section className="portal-intro">
        <div>
          <p className="eyebrow">Secure portal</p>
          <h1>Hello, {state.session.user.name}.</h1>
          <p>Your next actions come from your server-verified account permissions.</p>
        </div>
        <div className="identity-card">
          <small>Signed in as</small>
          <strong>{state.session.user.email}</strong>
          <span>{state.session.roles.join(' · ')}</span>
        </div>
      </section>

      <section className="portal-section" aria-labelledby="journeys-title">
        <div className="portal-section-heading">
          <div>
            <p className="eyebrow">Onboarding</p>
            <h2 id="journeys-title">Your journeys</h2>
          </div>
          <button className="quiet-button" onClick={() => void refresh()} type="button">
            <RefreshCw aria-hidden="true" size={16} /> Refresh
          </button>
        </div>

        {message ? <p className="form-message" role="alert">{message}</p> : null}

        <div className="journey-grid">
          {canManageBorrower ? (
            <JourneyStart
              caseType="borrower"
              disabled={state.cases.some((item) => item.caseType === 'borrower' && openStatuses.has(item.status))}
              pending={pendingAction === 'create-borrower'}
              onCreate={() => void runAction('create-borrower', () => createOnboardingCase('borrower'))}
            />
          ) : null}
          {canManageInvestor ? (
            <JourneyStart
              caseType="investor"
              disabled={state.cases.some((item) => item.caseType === 'investor' && openStatuses.has(item.status))}
              pending={pendingAction === 'create-investor'}
              onCreate={() => void runAction('create-investor', () => createOnboardingCase('investor'))}
            />
          ) : null}
        </div>

        {state.cases.length === 0 ? (
          <div className="empty-state">
            <h3>No onboarding case yet</h3>
            <p>Start the journey available to your verified account above.</p>
          </div>
        ) : (
          <div className="case-list">
            {state.cases.map((item) => {
              const canSubmit = item.caseType === 'borrower' ? canSubmitBorrower : canSubmitInvestor;
              const canManage = item.caseType === 'borrower' ? canManageBorrower : canManageInvestor;
              const submittable = canSubmit && (item.status === 'draft' || item.status === 'needs_information');
              const withdrawable = canManage && ['draft', 'submitted', 'needs_information'].includes(item.status);
              return (
                <article className="case-card" key={item.id}>
                  <div className="case-card-heading">
                    <div className="journey-icon" aria-hidden="true">
                      {item.caseType === 'borrower' ? <Building2 size={21} /> : <TrendingUp size={21} />}
                    </div>
                    <div>
                      <p>{item.caseType === 'borrower' ? 'SME borrower' : 'Investor'} journey</p>
                      <span className={`case-status status-${item.status}`}>{statusLabels[item.status]}</span>
                    </div>
                    <small>Version {item.version}</small>
                  </div>
                  <p className="case-meta">Updated {new Date(item.updatedAt).toLocaleString('en-PH')}</p>
                  <div className="case-actions">
                    <button
                      className="text-button"
                      disabled={Boolean(detailLoadingId)}
                      onClick={() => void toggleDetail(item.id)}
                      type="button"
                    >
                      {detailLoadingId === item.id
                        ? 'Loading history…'
                        : detail?.id === item.id ? 'Hide history' : 'View history'}
                    </button>
                    {submittable ? (
                      <button
                        className="compact-action button-reset"
                        disabled={Boolean(pendingAction)}
                        onClick={() => void runAction(`submit-${item.id}`, () => submitOnboardingCase(item.id, item.version))}
                        type="button"
                      >
                        {pendingAction === `submit-${item.id}` ? 'Submitting…' : item.status === 'needs_information' ? 'Resubmit case' : 'Submit for review'}
                      </button>
                    ) : null}
                    {withdrawable ? (
                      <button
                        className="text-button"
                        onClick={() => setWithdrawCaseId(withdrawCaseId === item.id ? null : item.id)}
                        type="button"
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </div>
                  {withdrawCaseId === item.id ? (
                    <form
                      className="withdraw-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void runAction(`withdraw-${item.id}`, () => withdrawOnboardingCase(
                          item.id,
                          item.version,
                          withdrawReason,
                        ));
                      }}
                    >
                      <label>
                        Why are you withdrawing this case?
                        <textarea
                          maxLength={1000}
                          minLength={10}
                          onChange={(event) => setWithdrawReason(event.target.value)}
                          required
                          value={withdrawReason}
                        />
                      </label>
                      <button className="danger-action" disabled={Boolean(pendingAction)} type="submit">
                        {pendingAction === `withdraw-${item.id}` ? 'Withdrawing…' : 'Confirm withdrawal'}
                      </button>
                    </form>
                  ) : null}
                  {detail?.id === item.id ? (
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
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function JourneyStart({
  caseType,
  disabled,
  pending,
  onCreate,
}: {
  caseType: CaseType;
  disabled: boolean;
  pending: boolean;
  onCreate(): void;
}) {
  const borrower = caseType === 'borrower';
  return (
    <article className="journey-start">
      {borrower ? <Building2 aria-hidden="true" size={23} /> : <TrendingUp aria-hidden="true" size={23} />}
      <div>
        <h3>{borrower ? 'SME borrower' : 'Investor'}</h3>
        <p>{borrower ? 'Prepare your business for review.' : 'Prepare your investor eligibility review.'}</p>
      </div>
      <button className="text-button" disabled={disabled || pending} onClick={onCreate} type="button">
        {disabled ? 'Open case exists' : pending ? 'Starting…' : 'Start journey'}
      </button>
    </article>
  );
}

function PortalState({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="portal-state">
      <span className="brand-mark" aria-hidden="true"><Sprout size={18} /></span>
      <h1>{title}</h1>
      <p>{detail}</p>
      {children}
    </main>
  );
}
