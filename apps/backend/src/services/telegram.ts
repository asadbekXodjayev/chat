import { env } from '../config/env';

/**
 * Telegram OTP delivery adapter (D4). When TELEGRAM_GATEWAY_TOKEN is set we send the code via the
 * official Telegram Gateway (gateway.telegram.org) which delivers to the user's Telegram BY PHONE
 * NUMBER (no bot /start needed), appearing from the "Verification Codes" sender. Until a token is
 * configured we log the code server-side so the flow is testable (and 136092 works in non-prod).
 */
export const TelegramService = {
  async sendVerificationCode(phone: string, code: string): Promise<{ delivered: boolean }> {
    if (!env.telegramGatewayToken) {
      // Dev fallback — never do this in prod (boot invariant blocks test hatch there anyway).
      console.warn(`[otp] (no TELEGRAM_GATEWAY_TOKEN) code for ${maskPhone(phone)} = ${code}`);
      return { delivered: false };
    }
    try {
      const res = await fetch('https://gateway.telegram.org/sendVerificationMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.telegramGatewayToken}`,
        },
        body: JSON.stringify({ phone_number: phone, code, sender_username: env.telegramGatewaySender }),
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      const delivered = res.ok && json?.ok === true;
      if (!delivered) console.error('[otp] telegram gateway send failed', res.status, json);
      return { delivered };
    } catch (err) {
      console.error('[otp] telegram gateway error', (err as Error).message);
      return { delivered: false };
    }
  },
};

function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}
