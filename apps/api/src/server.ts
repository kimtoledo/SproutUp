import { createDatabase } from '@sproutup/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
await database.check();

const app = await buildApp({
  config,
  checkDatabase: database.check,
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
