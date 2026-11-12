import type { DatabaseSync } from 'node:sqlite';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Clock } from '../clock.js';
import { createOwner, getOwner } from '../db/owners.js';

export const OWNER_COOKIE = 'minimi_owner';
const OWNER_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

function loopbackHostname(value: string): boolean {
  const normalized = value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value;
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function hostHeaderHostname(host: string | undefined): string | null {
  if (!host) return null;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end < 0) return null;
    return host.slice(1, end);
  }
  return host.split(':')[0] ?? null;
}

export interface OwnerMiddlewareOptions {
  database: DatabaseSync;
  clock: Clock;
  cookieName?: string;
}

export function ownerMiddleware(options: OwnerMiddlewareOptions): RequestHandler {
  const cookieName = options.cookieName ?? OWNER_COOKIE;
  return (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const existingId = cookies[cookieName];
    let ownerId: string | null = null;

    if (existingId) {
      try {
        const owner = getOwner(options.database, existingId);
        if (owner) ownerId = owner.id;
      } catch {
        ownerId = null;
      }
    }

    if (!ownerId) {
      const owner = createOwner(options.database, options.clock);
      ownerId = owner.id;
      res.cookie(cookieName, owner.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: OWNER_COOKIE_MAX_AGE_MS,
      });
    }

    res.locals.ownerId = ownerId;
    next();
  };
}

export function requestOwnerId(res: Response): string {
  const ownerId = res.locals.ownerId;
  if (typeof ownerId !== 'string') {
    throw new Error('Owner middleware did not establish an owner');
  }
  return ownerId;
}

export function localOriginGuard(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }

    const host = hostHeaderHostname(req.headers.host);
    if (host !== null && !loopbackHostname(host)) {
      res.status(403).json({
        error: {
          code: 'forbidden_origin',
          userMessage: 'This server only accepts local requests.',
          retryable: false,
          runId: null,
        },
      });
      return;
    }

    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        const protocolAllowed = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        if (!protocolAllowed || !loopbackHostname(parsed.hostname)) {
          res.status(403).json({
            error: {
              code: 'forbidden_origin',
              userMessage: 'This server only accepts local requests.',
              retryable: false,
              runId: null,
            },
          });
          return;
        }
      } catch {
        res.status(403).json({
          error: {
            code: 'forbidden_origin',
            userMessage: 'This server only accepts local requests.',
            retryable: false,
            runId: null,
          },
        });
        return;
      }
    }

    next();
  };
}
