import type { RoleKey } from '@sproutup/shared';
import type { PortalSession } from './portal-client';

export type ApprovalCommandType = 'role.assign' | 'role.revoke';
export type ApprovalStatus = 'pending' | 'executed' | 'rejected' | 'cancelled' | 'expired' | 'failed';

export interface RoleChangePayload {
  targetUserId: string;
  roleKey: RoleKey;
}

export interface PendingRoleChange {
  id: string;
  commandType: ApprovalCommandType;
  payload: RoleChangePayload;
  payloadHash: string;
  makerUserId: string;
  reason: string;
  expiresAt: string;
  createdAt: string;
}

export interface ApprovalHistoryItem {
  id: string;
  commandType: ApprovalCommandType;
  status: ApprovalStatus;
  payload: RoleChangePayload;
  payloadHash: string;
  version: number;
  makerUserId: string;
  checkerUserId: string | null;
  reason: string;
  expiresAt: string;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
  integrity: 'valid' | 'invalid';
}

export interface ApprovalAction {
  id: string;
  action: 'proposed' | 'approved' | 'executed' | 'rejected' | 'cancelled' | 'expired' | 'failed';
  actorUserId: string;
  payloadHash: string;
  reason: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface ApprovalHistoryDetail extends ApprovalHistoryItem {
  actions: ApprovalAction[];
}

export interface HistoryFilters {
  page: number;
  pageSize: number;
  commandType?: ApprovalCommandType;
  status?: ApprovalStatus;
}

export interface UserAccessSummary {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: 'active' | 'suspended' | 'disabled';
  roles: RoleKey[];
  createdAt: string;
}

export type RoleApprovalsWorkspaceResult =
  | { ok: true; session: PortalSession; pending: PendingRoleChange[] }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'unavailable' };

export type ApprovalCommandResult =
  | { ok: true }
  | { ok: false; message: string; unauthenticated?: boolean };

export type ApprovalHistoryResult =
  | { ok: true; approvals: ApprovalHistoryItem[]; page: number; pageSize: number; total: number }
  | { ok: false; message: string; unauthenticated?: boolean };

export type ApprovalDetailResult =
  | { ok: true; detail: ApprovalHistoryDetail }
  | { ok: false; message: string; unauthenticated?: boolean };

export type UserSearchResult =
  | { ok: true; users: UserAccessSummary[] }
  | { ok: false; message: string; unauthenticated?: boolean };

interface FetchLike {
  (input: string, init?: RequestInit): Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string };
}

function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

function init(method: string, body?: Record<string, unknown>): RequestInit {
  return {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
}

async function envelope<T>(response: Pick<Response, 'json'>): Promise<Envelope<T> | null> {
  try {
    return await response.json() as Envelope<T>;
  } catch {
    return null;
  }
}

export async function loadRoleApprovalsWorkspace(
  fetcher: FetchLike = fetch,
): Promise<RoleApprovalsWorkspaceResult> {
  try {
    const sessionResponse = await fetcher(`${apiBaseUrl()}/v1/session-context`, init('GET'));
    if (sessionResponse.status === 401) return { ok: false, reason: 'unauthenticated' };
    if (!sessionResponse.ok) return { ok: false, reason: 'unavailable' };
    const session = await envelope<PortalSession>(sessionResponse);
    if (!session?.success || !session.data) return { ok: false, reason: 'unavailable' };
    if (!session.data.permissions.includes('roles.assign')) {
      return { ok: false, reason: 'forbidden' };
    }

    const [assignmentsResponse, revocationsResponse] = await Promise.all([
      fetcher(`${apiBaseUrl()}/v1/admin/role-assignments`, init('GET')),
      fetcher(`${apiBaseUrl()}/v1/admin/role-revocations`, init('GET')),
    ]);
    if (assignmentsResponse.status === 401 || revocationsResponse.status === 401) {
      return { ok: false, reason: 'unauthenticated' };
    }
    if (assignmentsResponse.status === 403 || revocationsResponse.status === 403) {
      return { ok: false, reason: 'forbidden' };
    }
    if (!assignmentsResponse.ok || !revocationsResponse.ok) {
      return { ok: false, reason: 'unavailable' };
    }
    const assignments = await envelope<Array<Omit<PendingRoleChange, 'commandType'>>>(assignmentsResponse);
    const revocations = await envelope<Array<Omit<PendingRoleChange, 'commandType'>>>(revocationsResponse);
    if (!assignments?.success || !Array.isArray(assignments.data)
      || !revocations?.success || !Array.isArray(revocations.data)) {
      return { ok: false, reason: 'unavailable' };
    }
    const pending: PendingRoleChange[] = [
      ...assignments.data.map((item) => ({ ...item, commandType: 'role.assign' as const })),
      ...revocations.data.map((item) => ({ ...item, commandType: 'role.revoke' as const })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return { ok: true, session: session.data, pending };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function loadApprovalHistory(
  filters: HistoryFilters,
  fetcher: FetchLike = fetch,
): Promise<ApprovalHistoryResult> {
  try {
    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.commandType) query.set('commandType', filters.commandType);
    if (filters.status) query.set('status', filters.status);
    const response = await fetcher(`${apiBaseUrl()}/v1/admin/role-approvals?${query.toString()}`, init('GET'));
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    if (response.status === 403) {
      return { ok: false, message: 'Your account cannot view role approval history.' };
    }
    if (!response.ok) {
      return { ok: false, message: 'The approval history could not be loaded. Please try again.' };
    }
    const result = await envelope<{
      approvals: ApprovalHistoryItem[];
      page: number;
      pageSize: number;
      total: number;
    }>(response);
    if (!result?.success || !result.data || !Array.isArray(result.data.approvals)) {
      return { ok: false, message: 'The approval history could not be loaded. Please try again.' };
    }
    return { ok: true, ...result.data };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

export async function loadApprovalDetail(
  approvalId: string,
  fetcher: FetchLike = fetch,
): Promise<ApprovalDetailResult> {
  try {
    const response = await fetcher(`${apiBaseUrl()}/v1/admin/role-approvals/${approvalId}`, init('GET'));
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    if (response.status === 403) {
      return { ok: false, message: 'Your account cannot view role approval details.' };
    }
    if (response.status === 404) return { ok: false, message: 'That approval request is no longer available.' };
    if (!response.ok) {
      return { ok: false, message: 'The approval detail could not be loaded. Please try again.' };
    }
    const result = await envelope<ApprovalHistoryDetail>(response);
    if (!result?.success || !result.data || !Array.isArray(result.data.actions)) {
      return { ok: false, message: 'The approval detail could not be loaded. Please try again.' };
    }
    return { ok: true, detail: result.data };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

export async function searchUsers(
  query: string,
  fetcher: FetchLike = fetch,
): Promise<UserSearchResult> {
  try {
    const trimmed = query.trim();
    if (trimmed.length < 2) return { ok: true, users: [] };
    const params = new URLSearchParams({ page: '1', pageSize: '10', query: trimmed });
    const response = await fetcher(`${apiBaseUrl()}/v1/admin/users?${params.toString()}`, init('GET'));
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    if (response.status === 403) {
      return { ok: false, message: 'Your account cannot search the user catalogue.' };
    }
    if (!response.ok) return { ok: false, message: 'The user search could not be completed. Please try again.' };
    const result = await envelope<{ users: UserAccessSummary[] }>(response);
    if (!result?.success || !result.data || !Array.isArray(result.data.users)) {
      return { ok: false, message: 'The user search could not be completed. Please try again.' };
    }
    return { ok: true, users: result.data.users };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

const messages: Record<string, string> = {
  RESTRICTED_ROLE: 'Super Admin changes require an out-of-band bootstrap policy.',
  SELF_TARGET_NOT_ALLOWED: 'You cannot propose a role change for your own account.',
  SELF_APPROVAL_NOT_ALLOWED: 'You cannot approve your own proposal.',
  MAKER_CHECKER_CONFLICT: 'A different authorized reviewer must decide this request.',
  DUPLICATE_PENDING_APPROVAL: 'An equivalent request is already awaiting approval.',
  ROLE_ALREADY_ASSIGNED: 'That user already has this role.',
  ROLE_NOT_ASSIGNED: 'That user does not currently have this role.',
  LAST_ROLE_NOT_ALLOWED: 'An active account cannot lose its last role.',
  APPROVAL_NOT_PENDING: 'That request is no longer pending. The list has been reloaded.',
  APPROVAL_EXPIRED: 'That request expired. The list has been reloaded.',
  APPROVAL_PAYLOAD_MISMATCH: 'That request failed its integrity check and cannot proceed.',
  NOT_PROPOSAL_MAKER: 'Only the original proposer can cancel this request.',
  SELF_REVIEW_NOT_ALLOWED: 'You cannot review your own proposal.',
  TARGET_NOT_FOUND: 'That user account is no longer available.',
  ROLE_NOT_FOUND: 'That role is no longer available.',
  APPROVAL_NOT_FOUND: 'That approval request is no longer available.',
  FORBIDDEN: 'Your account does not have role-assignment permission.',
  VALIDATION_ERROR: 'Check the submitted details and try again.',
};

async function command(
  path: string,
  body: Record<string, unknown> | undefined,
  fetcher: FetchLike,
): Promise<ApprovalCommandResult> {
  try {
    const response = await fetcher(`${apiBaseUrl()}${path}`, init('POST', body));
    if (response.ok) return { ok: true };
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    const result = await envelope<never>(response);
    return {
      ok: false,
      message: messages[result?.error?.code ?? ''] ?? 'The request could not be completed. Please try again.',
    };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

export function proposeRoleAssignment(
  targetUserId: string,
  roleKey: RoleKey,
  reason: string,
  fetcher: FetchLike = fetch,
): Promise<ApprovalCommandResult> {
  return command('/v1/admin/role-assignments', { targetUserId, roleKey, reason: reason.trim() }, fetcher);
}

export function proposeRoleRevocation(
  targetUserId: string,
  roleKey: RoleKey,
  reason: string,
  fetcher: FetchLike = fetch,
): Promise<ApprovalCommandResult> {
  return command('/v1/admin/role-revocations', { targetUserId, roleKey, reason: reason.trim() }, fetcher);
}

export function approveRoleAssignment(
  approvalId: string,
  fetcher: FetchLike = fetch,
): Promise<ApprovalCommandResult> {
  return command(`/v1/admin/role-assignments/${approvalId}/approve`, undefined, fetcher);
}

export function approveRoleRevocation(
  approvalId: string,
  fetcher: FetchLike = fetch,
): Promise<ApprovalCommandResult> {
  return command(`/v1/admin/role-revocations/${approvalId}/approve`, undefined, fetcher);
}

export function rejectRoleApproval(
  approvalId: string,
  reason: string,
  fetcher: FetchLike = fetch,
): Promise<ApprovalCommandResult> {
  return command(`/v1/admin/role-approvals/${approvalId}/reject`, { reason: reason.trim() }, fetcher);
}

export function cancelRoleApproval(
  approvalId: string,
  reason: string,
  fetcher: FetchLike = fetch,
): Promise<ApprovalCommandResult> {
  return command(`/v1/admin/role-approvals/${approvalId}/cancel`, { reason: reason.trim() }, fetcher);
}
