import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

// Load root .env first (shared with frontend), then a backend-local .env override if present.
loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv(); // apps/backend/.env (optional)

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  port: int('PORT', 8080),
  publicApiBaseUrl: str('PUBLIC_API_BASE_URL', 'http://localhost:8080'),

  databaseUrl: str('DATABASE_URL', 'postgres://chat:chat@localhost:5432/chat'),
  redisUrl: str('REDIS_URL', 'redis://localhost:6379'),

  jwtSecret: str('JWT_SECRET', 'dev-only-change-me-in-prod'),
  accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL_SECONDS', 43_200),
  refreshTokenTtlSeconds: int('REFRESH_TOKEN_TTL_SECONDS', 604_800),

  mediaStorageDir: str('MEDIA_STORAGE_DIR', './.storage'),
  mediaMaxBytes: int('MEDIA_MAX_BYTES', 52_428_800),
  docMaxBytes: int('DOC_MAX_BYTES', 20_971_520),

  rlSendPerSec: int('RL_SEND_PER_SEC', 10),
  rlUploadPerMin: int('RL_UPLOAD_PER_MIN', 5),
  rlCallCreatePerMin: int('RL_CALL_CREATE_PER_MIN', 3),

  callsIceUrls: str('CALLS_ICE_URLS', 'stun:stun.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  callsTurnSecret: str('CALLS_TURN_SECRET', ''),
} as const;
