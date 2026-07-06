// §6.9 — global people search result item.
export interface ChatUserFinderItem {
  role: string;
  id: string;
  phone: string;
  name: string | null;
  has_photo?: boolean;
  photo?: string | null;
  photo_url?: string | null;
}
