import { serve } from '@hono/node-server';
import { loadConfig } from './server/config';
import { createApp } from './server/app';

const config = loadConfig();
const { app, services } = await createApp(config);

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    services.logger.info(
      {
        port: info.port,
        env: config.env,
        database: services.databaseKind,
        ...(services.databaseKind === 'pglite' ? { pgliteDir: config.pgliteDir } : {}),
      },
      'TALLY listening',
    );
  },
);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  services.logger.info({ signal }, 'Shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(async () => {
    try {
      await services.close();
    } catch {
      // best effort
    }
    clearTimeout(force);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  services.logger.error({ err: error }, 'Unhandled rejection');
});
process.on('uncaughtException', (error) => {
  services.logger.error({ err: error }, 'Uncaught exception');
  shutdown('uncaughtException');
});

export { app, services };
