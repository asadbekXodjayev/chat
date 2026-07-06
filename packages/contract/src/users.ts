// §6.9 — global people search result item. `role` is stripped for non-admins (§3.8).
export interface ChatUserFinderItem {
  id: string;
  phone: string;
  name: string | null;
  username?: string | null;
  role?: string;
  has_photo?: boolean;
  photo?: string | null;
  photo_url?: string | null;
}
