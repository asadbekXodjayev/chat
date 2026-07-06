import { useState, type FormEvent } from 'react';
import type { ChatParticipant } from '@chat/contract';
import { devLogin } from '../api/chat';

// Dev login — mints a token for a user identified by phone (stubbed IdP). Open the app in two
// browsers/profiles with two different phones to drive the browser-to-browser E2E.
export function LoginScreen({ onLoggedIn }: { onLoggedIn: (u: ChatParticipant) => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (phone.trim().length < 3) {
      setError('Enter a phone (min 3 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await devLogin(phone.trim(), name.trim() || undefined);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <span className="login__logo" aria-hidden>
            ✦
          </span>
          <h1>Chat Messenger</h1>
        </div>
        <p className="login__hint">Sign in with a phone number. Use two different numbers in two windows to test.</p>
        <label className="field">
          <span>Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+998 90 000 0000"
            autoFocus
            inputMode="tel"
          />
        </label>
        <label className="field">
          <span>Display name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alice" />
        </label>
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
