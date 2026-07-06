import { initials } from '../lib/format';

export function Avatar({
  name,
  phone,
  online,
  size = 44,
}: {
  name?: string | null;
  phone?: string | null;
  online?: boolean;
  size?: number;
}) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <span className="avatar__initials">{initials(name, phone)}</span>
      {online !== undefined && <span className={`avatar__dot ${online ? 'is-online' : ''}`} aria-hidden />}
    </span>
  );
}
