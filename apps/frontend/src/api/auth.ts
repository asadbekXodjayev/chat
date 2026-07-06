import {
  authEndpoints,
  userEndpoints,
  type ChatParticipant,
  type PublicUserProfile,
} from '@chat/contract';
import { apiRequest } from '../lib/apiClient';
import { setSession, updateUser, getRefreshToken, type TokenPair } from '../lib/session';

const v1 = (p: string) => `/v1${p}`;

export function requestCode(phone: string): Promise<{ status: string; resend_after: number; delivered: boolean }> {
  return apiRequest(v1(authEndpoints.requestCode()), { method: 'POST', body: { phone } });
}

export async function verifyCode(
  phone: string,
  code: string,
): Promise<{ user: ChatParticipant; needsRegistration: boolean }> {
  const data = await apiRequest<{ user: ChatParticipant; token: TokenPair; needs_registration: boolean }>(
    v1(authEndpoints.verifyCode()),
    { method: 'POST', body: { phone, code } },
  );
  setSession(data.user, data.token);
  return { user: data.user, needsRegistration: data.needs_registration };
}

export async function register(name: string, username: string): Promise<ChatParticipant> {
  const data = await apiRequest<{ user: ChatParticipant }>(v1(authEndpoints.register()), {
    method: 'POST',
    body: { name, username },
  });
  updateUser(data.user);
  return data.user;
}

export async function usernameAvailable(username: string): Promise<boolean> {
  const d = await apiRequest<{ available: boolean }>(v1(userEndpoints.usernameAvailable(username)));
  return d.available;
}

export function getMe(): Promise<PublicUserProfile> {
  return apiRequest(v1(userEndpoints.me()));
}

export async function updateProfile(patch: {
  name?: string;
  username?: string;
  bio?: string;
}): Promise<PublicUserProfile> {
  const me = await apiRequest<PublicUserProfile>(v1(userEndpoints.me()), { method: 'PATCH', body: patch });
  updateUser({
    id: me.id,
    name: me.name,
    phone: me.phone ?? '',
    role: me.role ?? 'user',
    username: me.username,
    has_photo: me.has_photo,
    photo_url: me.photo_url,
  });
  return me;
}

export async function logout(): Promise<void> {
  const refresh_token = getRefreshToken() ?? undefined;
  await apiRequest(v1(authEndpoints.logout()), { method: 'POST', body: { refresh_token } }).catch(() => undefined);
}
