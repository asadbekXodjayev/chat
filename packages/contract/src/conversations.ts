import type { ChatMessage } from './messages.js';
import type { ChatMessageType } from './messageType.js';

// §6.6
export interface ChatParticipant {
  id: string;
  name: string | null;
  phone: string;
  role: string;
}

export interface ChatConversation {
  id: string;
  peer_id: string;
  peer: ChatParticipant | null;
  last_message: ChatMessage | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
  peer_has_photo?: boolean;
  peer_photo_url?: string | null;
  // Summary fields (server wire names in comments) — list previews without loading messages.
  summary_last_message_at?: string | null; // last_message_at
  summary_preview?: string | null; // last_message_preview / last_message_body
  summary_last_message_type?: ChatMessageType | null; // last_message_type
  summary_from_me?: boolean | null; // last_message_from_me
  summary_peer_read?: boolean | null; // peer_read_my_last
  summary_last_message_id?: string | null; // last_message_id
}

export interface CreateConversationRequest {
  peer_id: string;
}
