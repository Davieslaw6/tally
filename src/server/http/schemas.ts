import { z } from 'zod';
import { Errors } from '../errors';

export const idSchema = z.string().min(6).max(128);
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const accountIdListSchema = z.array(idSchema).max(50).optional();
export const categoryIdListSchema = z.array(idSchema).max(50).optional();

export function parseCommaList(values: string[] | undefined): string[] | undefined {
  if (!values?.length) return undefined;
  const items = [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
  return items.length ? items : undefined;
}

export function booleanParam(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

export async function readJson<T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw Errors.badRequest('Request body must be valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid request.', {
      fields: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return parsed.data;
}
