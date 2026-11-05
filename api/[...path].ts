import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp, type TallyApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';

// Vercel reuses a warm Node.js process across invocations, so keep one app
// (and one PostgreSQL pool) alive between requests.
let appPromise: Promise<TallyApp> | undefined;

function getApp(): Promise<TallyApp> {
  appPromise ??= createApp(loadConfig()).catch((error: unknown) => {
    appPromise = undefined;
    throw error;
  });
  return appPromise;
}

let listenerPromise: ReturnType<typeof createListener> | undefined;

function createListener() {
  return getApp()
    .then(({ app }) => getRequestListener(app.fetch))
    .catch((error: unknown) => {
      // Let the next invocation retry a failed cold start (for example while a
      // suspended Neon database wakes up).
      listenerPromise = undefined;
      throw error;
    });
}

function getListener() {
  listenerPromise ??= createListener();
  return listenerPromise;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const listener = await getListener();
  await listener(request, response);
}
