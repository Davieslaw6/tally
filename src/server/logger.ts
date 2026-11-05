import type { AppConfig } from './config';

type LogPayload = Record<string, unknown>;
type LogFn = (payload: LogPayload | string, message?: string) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

const LEVELS: Record<string, number> = { silent: -1, debug: 10, info: 20, warn: 30, error: 40 };

function write(level: keyof typeof LEVELS, payload: LogPayload | string, message?: string): void {
  const entry = typeof payload === 'string' ? { msg: payload } : { ...payload, msg: message ?? payload.msg ?? '' };
  const line = JSON.stringify({ level, time: new Date().toISOString(), ...entry });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(config: AppConfig): { logger: Logger; close: () => void } {
  const threshold = LEVELS[config.logLevel] ?? LEVELS.info!;
  const emit = (level: keyof typeof LEVELS): LogFn =>
    threshold <= LEVELS[level]! && threshold >= 0
      ? (payload, message) => write(level, payload, message)
      : () => undefined;

  return {
    logger: {
      debug: emit('debug'),
      info: emit('info'),
      warn: emit('warn'),
      error: emit('error'),
    },
    close: () => undefined,
  };
}
