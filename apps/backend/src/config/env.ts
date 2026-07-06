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
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

const nodeEnv = str('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';

export const env = {
  nodeEnv,
  isProd,
  port: int('PORT', 8080),
  publicApiBaseUrl: str('PUBLIC_API_BASE_URL', 'http://localhost:8080'),

  databaseUrl: str('DATABASE_URL', 'postgres://chat:chat@localhost:5432/chat'),
  redisUrl: str('REDIS_URL', 'redis://localhost:6379'),

  // ── Auth (§3.12) — split access/refresh secrets. Default off the legacy JWT_SECRET so an
  // existing deployment keeps working until real per-purpose secrets are set (forces re-login).
  jwtSecret: str('JWT_SECRET', 'dev-only-change-me-in-prod'),
  authAccessSecret: str('AUTH_ACCESS_SECRET', str('JWT_SECRET', 'dev-only-change-me-in-prod')),
  authRefreshSecret: str('AUTH_REFRESH_SECRET', str('JWT_SECRET', 'dev-only-change-me-in-prod') + '::refresh'),
  accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL_SECONDS', 900), // 15 min — short-lived (stateful refresh below)
  refreshTokenTtlSeconds: int('REFRESH_TOKEN_TTL_SECONDS', 604_800), // 7 d

  // ── OTP (§3.1 / §3.6) ──
  otpTtlSeconds: int('OTP_TTL_SECONDS', 300),
  otpMaxAttempts: int('OTP_MAX_ATTEMPTS', 5),
  otpResendCooldownSeconds: int('OTP_RESEND_COOLDOWN_SECONDS', 60),
  otpRlPhonePerHour: int('OTP_RL_PHONE_PER_HOUR', 5),
  otpRlPhonePerDay: int('OTP_RL_PHONE_PER_DAY', 20),
  otpRlIpPerHour: int('OTP_RL_IP_PER_HOUR', 30),

  // ── Test hatch (§3.1 D2) — universal OTP for NON-prod testing only ──
  testOtp: str('AUTH_TEST_OTP', '136092'),
  authAllowTestOtp: bool('AUTH_ALLOW_TEST_OTP', !isProd), // default on in non-prod
  authAllowDevLogin: bool('AUTH_ALLOW_DEV_LOGIN', !isProd),

  // ── Admin (§3.2) — a single phone is provisioned to role='admin' at boot. Never via API. ──
  adminPhone: str('ADMIN_PHONE', ''),

  // ── Telegram OTP delivery (D4). Empty token → dev log fallback. ──
  telegramGatewayToken: str('TELEGRAM_GATEWAY_TOKEN', ''),
  telegramGatewaySender: str('TELEGRAM_GATEWAY_SENDER', 'Verification Codes'),

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

/**
 * Boot invariant (§3.1 D2/D3): the universal test OTP and dev-login are catastrophic in production
 * (login-as-anyone). Refuse to start if they are enabled with NODE_ENV=production.
 */
export function assertSafeAuthConfig(): void {
  if (env.isProd && (env.authAllowTestOtp || env.authAllowDevLogin)) {
    throw new Error(
      'FATAL: AUTH_ALLOW_TEST_OTP / AUTH_ALLOW_DEV_LOGIN must be disabled when NODE_ENV=production ' +
        '(they permit login as any account). Set them to false or unset NODE_ENV=production for dev.',
    );
  }
}
