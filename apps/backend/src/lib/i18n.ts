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
};

export function localize(key: string, language: string | null | undefined): string {
  const lang = resolveLanguage(language, 'en');
  const entry = CATALOGUE[key];
  if (!entry) return key;
  return entry[lang] ?? entry.en;
}
