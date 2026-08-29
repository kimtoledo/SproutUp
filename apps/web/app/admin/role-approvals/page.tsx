'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ShieldCheck, Sprout, UserCog } from 'lucide-react';
import { roleDefinitions, type RoleKey } from '@sproutup/shared';
import { signOutAdmin } from '@/lib/auth-client';
import {
  approveRoleAssignment,
  approveRoleRevocation,
  cancelRoleApproval,
  loadApprovalDetail,
  loadApprovalHistory,
  loadRoleApprovalsWorkspace,
  proposeRoleAssignment,
  proposeRoleRevocation,
  rejectRoleApproval,
  searchUsers,
  type ApprovalCommandResult,
  type ApprovalCommandType,
  type ApprovalHistoryDetail,
  type ApprovalHistoryResult,
  type ApprovalStatus,
  type HistoryFilters,
  type PendingRoleChange,
  type RoleApprovalsWorkspaceResult,
  type UserAccessSummary,
} from '@/lib/admin-role-approvals-client';
import { product } from '@/lib/product';

const statuses: ApprovalStatus[] = ['pending', 'executed', 'rejected', 'cancelled', 'expired', 'failed'];
const actionLabels: Record<string, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  executed: 'Executed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
  failed: 'Failed',
};

function roleLabel(key: RoleKey | null | undefined): string {
  if (!key) return 'unknown role';
  return roleDefinitions.find((role) => role.key === key)?.name ?? key;
}

function commandLabel(type: ApprovalCommandType): string {
  return type === 'role.assign' ? 'Grant' : 'Revoke';
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : 'unknown';
}

export default function AdminRoleApprovalsPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<RoleApprovalsWorkspaceResult | null>(null);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({ page: 1, pageSize: 25 });
  const [history, setHistory] = useState<ApprovalHistoryResult | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<{ id: string; action: 'reject' | 'cancel' } | null>(null);
  const [detail, setDetail] = useState<ApprovalHistoryDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const [proposeType, setProposeType] = useState<ApprovalCommandType>('role.assign');
  const [roleKey, setRoleKey] = useState<RoleKey | ''>('');
  const [reason, setReason] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<UserAccessSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserAccessSummary | null>(null);
  const [searching, setSearching] = useState(false);
  const [proposeMessage, setProposeMessage] = useState<string | null>(null);

  const refreshWorkspace = useCallback(async () => {
    setWorkspace(await loadRoleApprovalsWorkspace());
  }, []);
  const refreshHistory = useCallback(async (filters: HistoryFilters = historyFilters) => {
    setHistory(await loadApprovalHistory(filters));
  }, [historyFilters]);

  useEffect(() => {
    let active = true;
    void loadRoleApprovalsWorkspace().then((result) => {
      if (active) setWorkspace(result);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadApprovalHistory(historyFilters).then((result) => {
      if (active) setHistory(result);
    });
    return () => {
      active = false;
    };
  }, [historyFilters]);

  async function run(id: string, action: () => Promise<ApprovalCommandResult>) {
    if (pendingActionId) return;
    setPendingActionId(id);
    setMessage(null);
    const result = await action();
    if (!result.ok) {
      setMessage(result.message);
      if (result.unauthenticated) setWorkspace({ ok: false, reason: 'unauthenticated' });
    } else {
      setReasonAction(null);
    }
    await Promise.all([refreshWorkspace(), refreshHistory()]);
    setPendingActionId(null);
  }

  async function toggleDetail(approvalId: string) {
    if (detail?.id === approvalId) {
      setDetail(null);
      return;
    }
    if (detailLoadingId) return;
    setDetailLoadingId(approvalId);
    setMessage(null);
    const result = await loadApprovalDetail(approvalId);
    if (result.ok) {
      setDetail(result.detail);
    } else {
      setMessage(result.message);
      if (result.unauthenticated) setWorkspace({ ok: false, reason: 'unauthenticated' });
    }
    setDetailLoadingId(null);
  }

  async function runSearch() {
    if (searching || userQuery.trim().length < 2) return;
    setSearching(true);
    setProposeMessage(null);
    const result = await searchUsers(userQuery);
    if (result.ok) {
      setUserResults(result.users);
    } else {
      setProposeMessage(result.message);
      if (result.unauthenticated) setWorkspace({ ok: false, reason: 'unauthenticated' });
    }
    setSearching(false);
  }

  function selectUser(user: UserAccessSummary) {
    setSelectedUser(user);
    setUserResults([]);
    setUserQuery('');
  }

  async function submitPropose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser || !roleKey || pendingActionId) return;
    setPendingActionId('propose');
    setProposeMessage(null);
    const result = proposeType === 'role.assign'
      ? await proposeRoleAssignment(selectedUser.id, roleKey, reason)
      : await proposeRoleRevocation(selectedUser.id, roleKey, reason);
    if (result.ok) {
      setSelectedUser(null);
      setRoleKey('');
      setReason('');
      await Promise.all([refreshWorkspace(), refreshHistory()]);
    } else {
      setProposeMessage(result.message);
      if (result.unauthenticated) setWorkspace({ ok: false, reason: 'unauthenticated' });
    }
    setPendingActionId(null);
  }

  function updateHistoryFilters(changes: Partial<HistoryFilters>) {
    setHistory(null);
    setHistoryFilters((current) => ({ ...current, ...changes, page: changes.page ?? 1 }));
  }

  if (!workspace) {
    return <AdminState title="Loading role approvals…" detail="Resolving staff permissions and pending requests." />;
  }
  if (!workspace.ok) {
    const title = workspace.reason === 'unauthenticated'
      ? 'Staff sign-in is required.'
      : workspace.reason === 'forbidden'
        ? 'Role approvals are not available to your role.'
        : 'Role approvals are temporarily unavailable.';
    return (
      <AdminState title={title} detail="No approval data was displayed.">
        <Link href={workspace.reason === 'unauthenticated' ? '/login' : '/'} className="primary-action">
          Continue safely
        </Link>
      </AdminState>
    );
  }

  const currentUserId = workspace.session.user.id;
  const pages = history?.ok ? Math.max(1, Math.ceil(history.total / history.pageSize)) : 1;

  return (
    <main className="admin-page">
      <header className="admin-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true"><Sprout size={18} /></span>
          {product.name} <small>Operations</small>
        </Link>
        <div className="admin-nav-links">
          {workspace.session.permissions.includes('onboarding_cases.read') ? (
            <Link className="quiet-link" href="/admin/onboarding">Onboarding queue</Link>
          ) : null}
          <button className="quiet-button" type="button" onClick={() => void signOutAdmin().then(() => router.push('/login'))}>
            Sign out
          </button>
        </div>
      </header>

      <section className="admin-intro">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>Role approvals</h1>
          <p>Signed in as {workspace.session.user.email}. Every role change requires an independent maker and checker.</p>
        </div>
        <div className="queue-count"><strong>{workspace.pending.length}</strong><span>pending requests</span></div>
      </section>

      {message ? <p className="form-message" role="alert">{message}</p> : null}

      <section className="queue-panel">
        <h2>Pending role changes</h2>
        {workspace.pending.length === 0 ? (
          <div className="empty-state"><h3>No pending requests</h3><p>Propose a role change below to start a maker/checker review.</p></div>
        ) : (
          <div className="admin-case-list">
            {workspace.pending.map((item) => (
              <PendingCard
                currentUserId={currentUserId}
                item={item}
                key={item.id}
                pending={pendingActionId === item.id}
                reasonAction={reasonAction?.id === item.id ? reasonAction.action : null}
                onReasonAction={(action) => setReasonAction(
                  reasonAction?.id === item.id && reasonAction.action === action
                    ? null
                    : { id: item.id, action },
                )}
                onRun={(action) => void run(item.id, action)}
              />
            ))}
          </div>
        )}

        <h2>Propose a role change</h2>
        <form className="propose-form" onSubmit={submitPropose}>
          <div className="propose-type-toggle" role="radiogroup" aria-label="Change type">
            <label>
              <input
                checked={proposeType === 'role.assign'}
                name="proposeType"
                onChange={() => setProposeType('role.assign')}
                type="radio"
              /> Grant a role
            </label>
            <label>
              <input
                checked={proposeType === 'role.revoke'}
                name="proposeType"
                onChange={() => setProposeType('role.revoke')}
                type="radio"
              /> Revoke a role
            </label>
          </div>

          <label>
            Target user
            {selectedUser ? (
              <span className="selected-target">
                <span>{selectedUser.name} · {selectedUser.email} ({selectedUser.roles.map(roleLabel).join(', ') || 'no roles'})</span>
                <button className="text-button" onClick={() => setSelectedUser(null)} type="button">Change</button>
              </span>
            ) : (
              <>
                <input
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="Search by name or email"
                  type="text"
                  value={userQuery}
                />
                <button
                  className="compact-action button-reset"
                  disabled={searching || userQuery.trim().length < 2}
                  onClick={() => void runSearch()}
                  type="button"
                >{searching ? 'Searching…' : 'Find user'}</button>
                {userResults.length > 0 ? (
                  <div className="user-search-results">
                    {userResults.map((user) => (
                      <button
                        className="user-search-result"
                        key={user.id}
                        onClick={() => selectUser(user)}
                        type="button"
                      >
                        <span>{user.name} · {user.email}</span>
                        <span>{user.roles.map(roleLabel).join(', ') || 'no roles'}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </label>

          <label>
            Role
            <select
              onChange={(event) => setRoleKey(event.target.value as RoleKey)}
              required
              value={roleKey}
            >
              <option value="">Select a role</option>
              {roleDefinitions.map((role) => (
                <option key={role.key} value={role.key}>{role.name} ({role.category})</option>
              ))}
            </select>
          </label>

          <label>
            Reason
            <textarea
              minLength={10}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </label>

          {proposeMessage ? <p className="form-message" role="alert">{proposeMessage}</p> : null}
          <button
            className="compact-action button-reset"
            disabled={!selectedUser || !roleKey || pendingActionId === 'propose'}
            type="submit"
          >{pendingActionId === 'propose' ? 'Submitting…' : 'Submit for approval'}</button>
        </form>
      </section>

      <section className="queue-panel">
        <h2>Approval history</h2>
        <div className="queue-filters" aria-label="History filters">
          <label>Change type
            <select
              value={historyFilters.commandType ?? ''}
              onChange={(event) => updateHistoryFilters({
                commandType: (event.target.value || undefined) as ApprovalCommandType | undefined,
              })}
            >
              <option value="">All types</option>
              <option value="role.assign">Grant</option>
              <option value="role.revoke">Revoke</option>
            </select>
          </label>
          <label>Status
            <select
              value={historyFilters.status ?? ''}
              onChange={(event) => updateHistoryFilters({
                status: (event.target.value || undefined) as ApprovalStatus | undefined,
              })}
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option value={status} key={status}>{status}</option>
              ))}
            </select>
          </label>
          <button className="quiet-button" onClick={() => void refreshHistory()} type="button">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {!history ? <p>Loading approval history…</p> : !history.ok ? (
          <p className="form-message" role="alert">{history.message}</p>
        ) : history.approvals.length === 0 ? (
          <div className="empty-state"><h3>No matching approvals</h3><p>Adjust the filters or propose a new role change above.</p></div>
        ) : (
          <>
            <div className="admin-case-list">
              {history.approvals.map((item) => (
                <article className="admin-case-card" key={item.id}>
                  <div className="admin-case-main">
                    <div className="journey-icon"><ShieldCheck size={20} /></div>
                    <div>
                      <strong>{commandLabel(item.commandType)} {roleLabel(item.payload.roleKey)}</strong>
                      <span>Target {shortId(item.payload.targetUserId)}</span>
                    </div>
                    <span className={`case-status status-${item.status}`}>{item.status}</span>
                    <small>v{item.version} · {new Date(item.updatedAt).toLocaleString('en-PH')}</small>
                  </div>
                  {item.integrity === 'invalid' ? (
                    <p className="danger-text">Integrity check failed — treat as a security exception.</p>
                  ) : null}
                  <div className="admin-case-actions">
                    <button
                      className="text-button"
                      disabled={detailLoadingId === item.id}
                      onClick={() => void toggleDetail(item.id)}
                      type="button"
                    >
                      {detailLoadingId === item.id
                        ? 'Loading timeline…'
                        : detail?.id === item.id ? 'Hide timeline' : 'View timeline'}
                    </button>
                  </div>
                  {detail?.id === item.id ? (
                    <section className="case-timeline" aria-label="Approval action timeline">
                      <h3>Action timeline</h3>
                      <ol>
                        {detail.actions.map((action) => (
                          <li key={action.id}>
                            <span className="timeline-marker" aria-hidden="true" />
                            <div>
                              <strong>{actionLabels[action.action] ?? action.action}</strong>
                              <small>
                                {new Date(action.occurredAt).toLocaleString('en-PH')} · {shortId(action.actorUserId)}
                              </small>
                              {action.reason ? <p>{action.reason}</p> : null}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="pagination" aria-label="History pages">
              <button
                disabled={historyFilters.page <= 1}
                onClick={() => updateHistoryFilters({ page: historyFilters.page - 1 })}
                type="button"
              ><ChevronLeft size={16} /> Previous</button>
              <span>Page {history.page} of {pages}</span>
              <button
                disabled={historyFilters.page >= pages}
                onClick={() => updateHistoryFilters({ page: historyFilters.page + 1 })}
                type="button"
              >Next <ChevronRight size={16} /></button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function PendingCard({
  item,
  currentUserId,
  pending,
  reasonAction,
  onReasonAction,
  onRun,
}: {
  item: PendingRoleChange;
  currentUserId: string;
  pending: boolean;
  reasonAction: 'reject' | 'cancel' | null;
  onReasonAction(action: 'reject' | 'cancel'): void;
  onRun(action: () => Promise<ApprovalCommandResult>): void;
}) {
  const isMaker = item.makerUserId === currentUserId;
  function submitReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    onRun(() => reasonAction === 'reject'
      ? rejectRoleApproval(item.id, reason)
      : cancelRoleApproval(item.id, reason));
  }
  return (
    <article className="admin-case-card">
      <div className="admin-case-main">
        <div className="journey-icon"><UserCog size={20} /></div>
        <div>
          <strong>{commandLabel(item.commandType)} {roleLabel(item.payload.roleKey)}</strong>
          <span>Target {shortId(item.payload.targetUserId)}</span>
        </div>
        <span className="case-status">Pending</span>
        <small>Expires {new Date(item.expiresAt).toLocaleString('en-PH')}</small>
      </div>
      <p className="case-meta">{item.reason}</p>
      <div className="admin-case-actions">
        {isMaker ? (
          <>
            <span className="assigned-note">You proposed this change</span>
            <button className="text-button danger-text" onClick={() => onReasonAction('cancel')} type="button">Cancel</button>
          </>
        ) : (
          <>
            <button
              className="compact-action button-reset"
              disabled={pending}
              onClick={() => onRun(() => item.commandType === 'role.assign'
                ? approveRoleAssignment(item.id)
                : approveRoleRevocation(item.id))}
              type="button"
            >{pending ? 'Saving…' : 'Approve'}</button>
            <button className="text-button danger-text" onClick={() => onReasonAction('reject')} type="button">Reject</button>
          </>
        )}
      </div>
      {reasonAction ? (
        <form className="review-reason-form" onSubmit={submitReason}>
          <label>
            {reasonAction === 'reject' ? 'Rejection reason' : 'Cancellation reason'}
            <textarea minLength={10} maxLength={500} name="reason" required />
          </label>
          <button
            className={reasonAction === 'reject' ? 'danger-action' : 'compact-action button-reset'}
            disabled={pending}
            type="submit"
          >{pending ? 'Saving…' : reasonAction === 'reject' ? 'Confirm rejection' : 'Confirm cancellation'}</button>
        </form>
      ) : null}
    </article>
  );
}

function AdminState({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <main className="portal-state">
      <span className="brand-mark"><ShieldCheck size={18} /></span>
      <h1>{title}</h1><p>{detail}</p>{children}
    </main>
  );
}
