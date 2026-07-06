import { resolveLanguage, type SupportedLanguage } from '@chat/contract';

// §7 / §15.4 — the server localizes the envelope `description` (and push text) by X-Language.
// A small catalogue for the messages this foundation slice can produce. Missing keys fall back to `en`.
type Catalogue = Record<string, Partial<Record<SupportedLanguage, string>> & { en: string }>;

const CATALOGUE: Catalogue = {
  ok: { en: 'OK', ru: 'Готово', uz: 'Bajarildi', tr: 'Tamam', zh: '完成' },
  created: { en: 'Created', ru: 'Создано', uz: 'Yaratildi' },
  invalid_payload_detail: {
    en: 'Invalid or missing fields',
    ru: 'Неверные или отсутствующие поля',
    uz: 'Notoʻgʻri yoki yetishmayotgan maydonlar',
  },
  user_not_identified: {
    en: 'Authentication required',
    ru: 'Требуется авторизация',
    uz: 'Avtorizatsiya talab qilinadi',
  },
  forbidden: { en: 'Forbidden', ru: 'Доступ запрещён', uz: 'Ruxsat yoʻq' },
  conversation_not_found: { en: 'Conversation not found', ru: 'Диалог не найден', uz: 'Suhbat topilmadi' },
  message_not_found: { en: 'Message not found', ru: 'Сообщение не найдено', uz: 'Xabar topilmadi' },
  call_not_found: { en: 'Call not found', ru: 'Звонок не найден', uz: 'Qoʻngʻiroq topilmadi' },
  call_user_busy: { en: 'You are already in a call', ru: 'Вы уже в звонке', uz: 'Siz allaqachon qoʻngʻiroqdasiz' },
  call_peer_busy: { en: 'The user is busy', ru: 'Пользователь занят', uz: 'Foydalanuvchi band' },
  call_invalid_state: { en: 'Invalid call state', ru: 'Недопустимое состояние звонка', uz: 'Notoʻgʻri holat' },
  rate_limited: { en: 'Too many requests', ru: 'Слишком много запросов', uz: 'Juda koʻp soʻrov' },
  internal_error: { en: 'Server error', ru: 'Ошибка сервера', uz: 'Server xatosi' },
  file_too_large: { en: 'File too large', ru: 'Файл слишком большой', uz: 'Fayl juda katta' },
  unsupported_media_type: { en: 'Unsupported file type', ru: 'Неподдерживаемый тип файла', uz: 'Qoʻllab-quvvatlanmaydigan tur' },
  otp_sent: { en: 'Verification code sent', ru: 'Код подтверждения отправлен', uz: 'Tasdiqlash kodi yuborildi' },
  otp_invalid: { en: 'Invalid verification code', ru: 'Неверный код', uz: 'Kod notoʻgʻri' },
  otp_expired: { en: 'Code expired — request a new one', ru: 'Код истёк — запросите новый', uz: 'Kod eskirdi — yangisini soʻrang' },
  otp_too_many_attempts: {
    en: 'Too many attempts — request a new code',
    ru: 'Слишком много попыток — запросите новый код',
    uz: 'Juda koʻp urinish — yangi kod soʻrang',
  },
  code_send_throttled: {
    en: 'Please wait before requesting another code',
    ru: 'Подождите перед повторным запросом кода',
    uz: 'Yangi kod soʻrashdan oldin kuting',
  },
  forbidden_admin_only: { en: 'Admins only', ru: 'Только для администраторов', uz: 'Faqat administratorlar uchun' },
  username_taken: { en: 'That username is taken', ru: 'Это имя пользователя занято', uz: 'Bu foydalanuvchi nomi band' },
  username_invalid: {
    en: 'Username must be 3–32 letters, digits or underscores',
    ru: 'Имя: 3–32 буквы, цифры или подчёркивания',
    uz: 'Nom: 3–32 harf, raqam yoki pastki chiziq',
  },
};

export function localize(key: string, language: string | null | undefined): string {
  const lang = resolveLanguage(language, 'en');
  const entry = CATALOGUE[key];
  if (!entry) return key;
  return entry[lang] ?? entry.en;
}
