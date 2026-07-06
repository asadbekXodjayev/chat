// §12.4 FR-33 — three bouncing dots, left-aligned.
export function TypingIndicator() {
  return (
    <div className="bubble bubble--peer bubble--typing" aria-label="typing">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  );
}
