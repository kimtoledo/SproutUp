import { createDatabase } from '@sproutup/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import {
  createAdminAuthServices,
  createBorrowerAuthServices,
  createCustomerAuthServices,
  createInvestorAuthServices,
} from './auth/service.js';
import { createSessionService } from './auth/sessions-service.js';
import { createRoleAssignmentService } from './auth/role-assignments-service.js';
import { createAccessCatalogueService } from './auth/access-catalogue-service.js';
import { createRoleRevocationService } from './auth/role-revocations-service.js';
import { createApprovalLifecycleService } from './auth/approval-lifecycle-service.js';
import { createApprovalHistoryService } from './auth/approval-history-service.js';
import { createOnboardingCaseService } from './onboarding/case-service.js';
import { createOnboardingReviewService } from './onboarding/review-service.js';

const config = loadConfig();
// Keep third-party libraries (Better Auth's dev/test detection, etc.) aligned
// with the resolved environment when the process was started without NODE_ENV.
process.env.NODE_ENV ??= config.environment;
const database = createDatabase(config.databaseUrl);
await database.check();
const adminAuth = createAdminAuthServices(config, database.db);
const borrowerAuth = createBorrowerAuthServices(config, database.db);
const investorAuth = createInvestorAuthServices(config, database.db);
const customerAuth = createCustomerAuthServices(database.db, borrowerAuth, investorAuth);
const sessions = createSessionService(database.db);
const roleAssignments = createRoleAssignmentService(database.db);
const catalogue = createAccessCatalogueService(database.db);
const roleRevocations = createRoleRevocationService(database.db);
const approvalLifecycle = createApprovalLifecycleService(database.db);
const approvalHistory = createApprovalHistoryService(database.db);
const onboardingCases = createOnboardingCaseService(database.db);
const onboardingReview = createOnboardingReviewService(database.db);

const app = await buildApp({
  config,
  checkDatabase: database.check,
  auth: {
    service: customerAuth,
    adminService: adminAuth,
    borrowerService: borrowerAuth,
    investorService: investorAuth,
    baseUrl: config.authBaseUrl,
    sessions,
    roleAssignments,
    catalogue,
    roleRevocations,
    approvalLifecycle,
    approvalHistory,
  },
  onboarding: { cases: onboardingCases, review: onboardingReview },
});

app.addHook('onClose', async () => {
  await database.close();
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down API server');

  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'API shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'API failed to start');
  await app.close();
  process.exitCode = 1;
}
