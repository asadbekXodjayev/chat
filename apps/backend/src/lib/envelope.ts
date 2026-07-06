import type { FastifyReply } from 'fastify';
import type { ApiResponse } from '@chat/contract';
import { localize } from './i18n';

// §6.1 / §15.4 — every REST response is wrapped in {status, code, description, data}.
// `description` is localized here (server-side) from an i18n key + the request language.

export interface RequestLike {
  language?: string | null;
}

/** A thrown ApiError becomes a localized error envelope with the right HTTP status. */
export class ApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly i18nKey: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(i18nKey);
    this.name = 'ApiError';
  }
}

export function envelope<T>(opts: {
  status?: string;
  code: number;
  descriptionKey: string;
  language: string | null | undefined;
  data: T | null;
}): ApiResponse<T> {
  return {
    status: opts.status ?? (opts.code < 400 ? 'success' : 'error'),
    code: opts.code,
    description: localize(opts.descriptionKey, opts.language),
    data: opts.data,
  };
}

export function sendOk<T>(
  reply: FastifyReply,
  data: T,
  opts: { code?: number; descriptionKey?: string; language: string | null | undefined },
): FastifyReply {
  const code = opts.code ?? 200;
  return reply.code(code).send(
    envelope({ code, descriptionKey: opts.descriptionKey ?? (code === 201 ? 'created' : 'ok'), language: opts.language, data }),
  );
}

export function sendError(
  reply: FastifyReply,
  err: ApiError,
  language: string | null | undefined,
): FastifyReply {
  return reply.code(err.httpStatus).send(
    envelope({ code: err.httpStatus, descriptionKey: err.i18nKey, language, data: err.extra ?? null }),
  );
}
