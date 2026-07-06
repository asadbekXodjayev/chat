import { randomInt, timingSafeEqual } from 'node:crypto';
import { redis } from '../redis/redis';
import { env } from '../config/env';
import { ApiError } from '../lib/envelope';
import { sha256 } from '../lib/auth';
import { TelegramService } from './telegram';

/** Normalize a user-entered phone toward E.164: keep a single leading '+' and digits only. */
export function normalizePhone(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return (hasPlus ? '+' : '') + digits;
}

export function isPlausiblePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

const key = (phone: string) => sha256(phone);
const reqKey = (h: string) => `otp:req:${h}`;
const attKey = (h: string) => `otp:att:${h}`;
const coolKey = (h: string) => `otp:cooldown:${h}`;

/** Fixed-window counter; throws `errKey` (429) with Retry-After when the limit is exceeded. */
async function hitLimit(bucket: string, limit: number, windowSeconds: number, errKey: string): Promise<void> {
  const k = `otp:rl:${bucket}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSeconds);
  if (n > limit) {
    const ttl = await redis.ttl(k);
    throw new ApiError(429, errKey, { retry_after: ttl > 0 ? ttl : windowSeconds });
  }
}

export const OtpService = {
  /**
   * Generate + deliver a code. Rate-limited per-phone and per-IP; uniform result so the caller can
   * respond `code_sent` regardless of whether the account exists (no enumeration).
   */
  async requestCode(phoneRaw: string, ip: string | null): Promise<{ resendAfter: number; delivered: boolean }> {
    const phone = normalizePhone(phoneRaw);
    if (!isPlausiblePhone(phone)) throw new ApiError(400, 'invalid_payload_detail');
    const h = key(phone);

    // Resend cooldown.
    const cooling = await redis.ttl(coolKey(h));
    if (cooling > 0) throw new ApiError(429, 'code_send_throttled', { retry_after: cooling });

    // Rate limits (per-phone hour/day, per-IP hour).
    await hitLimit(`phone:h:${h}`, env.otpRlPhonePerHour, 3600, 'code_send_throttled');
    await hitLimit(`phone:d:${h}`, env.otpRlPhonePerDay, 86_400, 'code_send_throttled');
    if (ip) await hitLimit(`ip:h:${sha256(ip)}`, env.otpRlIpPerHour, 3600, 'code_send_throttled');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await redis.set(reqKey(h), sha256(code), 'EX', env.otpTtlSeconds);
    await redis.set(attKey(h), '0', 'EX', env.otpTtlSeconds);
    await redis.set(coolKey(h), '1', 'EX', env.otpResendCooldownSeconds);

    const { delivered } = await TelegramService.sendVerificationCode(phone, code);
    return { resendAfter: env.otpResendCooldownSeconds, delivered };
  },

  /** Verify a code. Returns the normalized phone on success; throws a localized ApiError otherwise. */
  async verifyCode(phoneRaw: string, codeRaw: string): Promise<string> {
    const phone = normalizePhone(phoneRaw);
    const code = (codeRaw ?? '').trim();
    if (!isPlausiblePhone(phone) || !/^\d{4,8}$/.test(code)) throw new ApiError(400, 'invalid_payload_detail');
    const h = key(phone);

    // Test hatch (§3.1 D2): non-prod only, verifies ANY phone, bypasses only the compare — never limits.
    if (env.authAllowTestOtp && !env.isProd && safeEqual(code, env.testOtp)) {
      console.warn(`[auth] TEST OTP accepted for ${phone} (AUTH_ALLOW_TEST_OTP=on, non-prod)`);
      await redis.del(reqKey(h), attKey(h));
      return phone;
    }

    const storedHash = await redis.get(reqKey(h));
    if (!storedHash) throw new ApiError(400, 'otp_expired');

    const attempts = Number((await redis.get(attKey(h))) ?? '0');
    if (attempts >= env.otpMaxAttempts) {
      await redis.del(reqKey(h), attKey(h));
      throw new ApiError(429, 'otp_too_many_attempts');
    }

    if (!safeEqual(sha256(code), storedHash)) {
      await redis.incr(attKey(h)); // INCR preserves the existing TTL
      throw new ApiError(400, 'otp_invalid');
    }

    await redis.del(reqKey(h), attKey(h), coolKey(h)); // single-use
    return phone;
  },
};

/** Constant-time string compare (length-safe). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
