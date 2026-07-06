// §6.x — message reactions (emoji OR free text, multiple per user, per-key counters).
export interface ChatReactionAggregate {
  key: string; // emoji char, or 't:<lowercased text>'
  kind: 'emoji' | 'text';
  emoji?: string | null;
  text?: string | null;
  count: number;
  reacted_by_me: boolean;
}

export interface ToggleReactionRequest {
  emoji?: string;
  text?: string;
}
