// §6.2 — profile & auth wire types (Telegram-style identity).
export type UserRole = 'user' | 'admin';

export interface PublicUserProfile {
  id: string;
  name: string | null;
  username?: string | null;
  bio?: string | null;
  phone?: string; // present only on the self profile (GET /users/me)
  role?: string; // present only on the self profile
  has_photo: boolean;
  photo_url: string | null;
  last_seen?: number | null; // epoch ms
}

export interface UpdateProfileRequest {
  name?: string;
  username?: string;
  bio?: string;
}

export interface UsernameAvailableResponse {
  available: boolean;
}

// ── Auth flow ──
export interface RequestCodeRequest {
  phone: string;
}
export interface RequestCodeResponse {
  status: 'code_sent';
  resend_after: number;
  delivered: boolean;
}
export interface VerifyCodeRequest {
  phone: string;
  code: string;
}
export interface RegisterRequest {
  name: string;
  username: string;
}
