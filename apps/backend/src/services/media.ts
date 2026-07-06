import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ChatMessage, FileProbeResponse } from '@chat/contract';
import { normalizeChatMessageType } from '@chat/contract';
import { query } from '../db/pool';
import { env } from '../config/env';
import { ApiError } from '../lib/envelope';
import { MessageService } from './messages';
import type { ConversationRow } from './conversations';

export interface AttachmentRow {
  id: string;
  sha256: string;
  kind: string | null;
  mime: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  has_thumb: boolean;
  storage_key: string;
  thumb_key: string | null;
}

// §6.6 media whitelist (Q6) — image/audio/video/pdf/office/archive/text.
const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'text/'];
const ALLOWED_MIME_EXACT = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/octet-stream',
]);

function storageDir(): string {
  return resolve(process.cwd(), env.mediaStorageDir);
}

function isMimeAllowed(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p)) || ALLOWED_MIME_EXACT.has(mime);
}

export const MediaService = {
  async findBySha(sha256: string): Promise<AttachmentRow | null> {
    const r = await query<AttachmentRow>('SELECT * FROM attachments WHERE sha256 = $1', [sha256]);
    return r.rows[0] ?? null;
  },

  async getById(id: string): Promise<AttachmentRow | null> {
    const r = await query<AttachmentRow>('SELECT * FROM attachments WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  },

  // §8.1 #10 — dedup existence check before upload.
  async probe(sha256: string): Promise<FileProbeResponse> {
    const a = await this.findBySha(sha256);
    if (!a) return { exists: false };
    return {
      exists: true,
      kind: a.kind ?? undefined,
      mime: a.mime ?? undefined,
      size_bytes: a.size_bytes ?? undefined,
      duration_ms: a.duration_ms ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
      has_thumb: a.has_thumb,
    };
  },

  /** Store a blob (dedup by sha256) and return its attachment row. */
  async store(buffer: Buffer, mime: string, kind: string): Promise<AttachmentRow> {
    const maxBytes = kind === 'document' ? env.docMaxBytes : env.mediaMaxBytes;
    if (buffer.byteLength > maxBytes) throw new ApiError(413, 'file_too_large');
    if (!isMimeAllowed(mime)) throw new ApiError(415, 'unsupported_media_type');

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = await this.findBySha(sha256);
    if (existing) return existing;

    const dir = storageDir();
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const storageKey = sha256;
    await writeFile(join(dir, storageKey), buffer);

    const inserted = await query<AttachmentRow>(
      `INSERT INTO attachments (sha256, kind, mime, size_bytes, has_thumb, storage_key)
       VALUES ($1, $2, $3, $4, false, $5) RETURNING *`,
      [sha256, kind, mime, buffer.byteLength, storageKey],
    );
    return inserted.rows[0]!;
  },

  async readBlob(a: AttachmentRow): Promise<Buffer> {
    return readFile(join(storageDir(), a.storage_key));
  },

  /** Build the media payload + send a message referencing an attachment. */
  async sendMediaMessage(
    conv: ConversationRow,
    senderId: string,
    type: string,
    attachment: AttachmentRow,
    body: string | null,
    filename: string | null,
    clientRequestId: string | null,
  ): Promise<ChatMessage> {
    const canonicalType = normalizeChatMessageType(type);
    const payload = {
      attachment_id: attachment.id,
      mime: attachment.mime ?? undefined,
      size_bytes: attachment.size_bytes ?? undefined,
      duration_ms: attachment.duration_ms ?? null,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      filename: filename ?? undefined,
      name: filename ?? undefined,
      links: { media: `/v1/chat/media/${attachment.id}`, thumb: null },
    };
    return MessageService.send(conv, senderId, {
      type: canonicalType,
      body,
      payload,
      clientRequestId,
    });
  },
};
