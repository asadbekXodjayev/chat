import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ArrowLeft } from 'lucide-react';
import type { ChatParticipant } from '@chat/contract';
import { requestCode, verifyCode, register, usernameAvailable } from '../api/auth';
import { ApiError } from '../lib/apiClient';

type Step = 'phone' | 'code' | 'register';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (u: ChatParticipant) => void }) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [devNote, setDevNote] = useState(false);
  const [uAvail, setUAvail] = useState<'idle' | 'checking' | 'yes' | 'no'>('idle');

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // Live @username availability (debounced).
  useEffect(() => {
    if (step !== 'register') return;
    const u = username.trim();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(u)) {
      setUAvail('idle');
      return;
    }
    setUAvail('checking');
    const t = setTimeout(() => {
      usernameAvailable(u)
        .then((ok) => setUAvail(ok ? 'yes' : 'no'))
        .catch(() => setUAvail('idle'));
    }, 400);
    return () => clearTimeout(t);
  }, [username, step]);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return setError('Enter a valid phone number.');
    setBusy(true);
    setError(null);
    try {
      const res = await requestCode(phone.trim());
      setStep('code');
      setResendIn(res.resend_after || 60);
      setDevNote(res.delivered === false);
      setCode('');
    } catch (err) {
      // Throttled (a code was requested recently)? Still let them enter the code they may already
      // have — or the test code 136092, which verifies without a fresh request.
      if (err instanceof ApiError && err.status === 429) {
        setStep('code');
        setDevNote(true);
        setResendIn(60);
        setCode('');
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Could not send code');
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const { user, needsRegistration } = await verifyCode(phone.trim(), value);
      if (needsRegistration) setStep('register');
      else onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const onCodeChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !busy) void submitCode(digits);
  };

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const u = username.trim();
    if (n.length < 1) return setError('Enter your name.');
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(u)) return setError('Username: 3–32 letters, digits or _');
    if (uAvail === 'no') return setError('That username is taken.');
    setBusy(true);
    setError(null);
    try {
      const user = await register(n, u);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__hero" aria-hidden>
        <span className="auth__orb auth__orb--1" />
        <span className="auth__orb auth__orb--2" />
        <span className="auth__orb auth__orb--3" />
        <span className="auth__grid" />
      </div>

      <div className="auth__stage">
        <div className="auth__card" role="group" aria-label="Sign in">
          <div className="auth__brand">
            <span className="auth__logo" aria-hidden>◎</span>
            <span className="auth__brandname">Chat</span>
          </div>

          {step === 'phone' && (
            <form className="auth__panel" onSubmit={sendCode}>
              <h1 className="auth__title">Welcome</h1>
              <p className="auth__sub">Enter your phone number to sign in or create an account.</p>
              <label className="field">
                <span>Phone number</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998 90 123 4567"
                  inputMode="tel"
                  autoFocus
                  autoComplete="tel"
                />
              </label>
              {error && <p className="auth__error" role="alert">{error}</p>}
              <button className="btn btn--primary btn--lg" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Continue'}
              </button>
              <p className="auth__fine">We’ll send a login code to your Telegram.</p>
            </form>
          )}

          {step === 'code' && (
            <div className="auth__panel">
              <button className="auth__back" onClick={() => setStep('phone')} type="button"><ArrowLeft size={15} aria-hidden /> {phone}</button>
              <h1 className="auth__title">Enter code</h1>
              <p className="auth__sub">
                We sent a 6-digit code to your Telegram for <b>{phone}</b>.
              </p>
              <OtpInput value={code} onChange={onCodeChange} disabled={busy} />
              {error && <p className="auth__error" role="alert">{error}</p>}
              {devNote && (
                <p className="auth__fine auth__fine--warn">
                  Delivery not configured — use test code <b>136092</b> (or check server logs).
                </p>
              )}
              <div className="auth__resend">
                {resendIn > 0 ? (
                  <span className="muted">Resend code in {resendIn}s</span>
                ) : (
                  <button className="btn btn--ghost" type="button" onClick={() => void sendCode()} disabled={busy}>
                    Resend code
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'register' && (
            <form className="auth__panel" onSubmit={submitRegister}>
              <h1 className="auth__title">Create your profile</h1>
              <p className="auth__sub">Pick a name and a unique @username.</p>
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus maxLength={64} />
              </label>
              <label className="field">
                <span>Username</span>
                <div className="field__wrap">
                  <span className="field__prefix">@</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    placeholder="username"
                    maxLength={32}
                    autoComplete="off"
                  />
                  {uAvail === 'checking' && <span className="field__hint">…</span>}
                  {uAvail === 'yes' && <span className="field__hint field__hint--ok"><Check size={16} aria-hidden /></span>}
                  {uAvail === 'no' && <span className="field__hint field__hint--bad">taken</span>}
                </div>
              </label>
              {error && <p className="auth__error" role="alert">{error}</p>}
              <button className="btn btn--primary btn--lg" type="submit" disabled={busy || uAvail === 'no'}>
                {busy ? 'Finishing…' : 'Start messaging'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function OtpInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <button className="otp" type="button" onClick={() => ref.current?.focus()} aria-label="Enter verification code">
      {Array.from({ length: 6 }).map((_, i) => (
        <span key={i} className={`otp__cell${value.length === i ? ' is-active' : ''}${value[i] ? ' is-filled' : ''}`}>
          {value[i] ?? ''}
        </span>
      ))}
      <input
        ref={ref}
        className="otp__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        disabled={disabled}
        aria-label="Verification code"
      />
    </button>
  );
}
