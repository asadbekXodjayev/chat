import type { KeyboardEvent, PointerEvent } from 'react';
import { useUiStore } from '../stores/useUiStore';

const MIN = 32; // 2rem — avatar rail
const maxW = () => Math.round(window.innerWidth * 0.6); // 60vw

/** Desktop-only drag handle for the sidebar width (§7.2). Keyboard-accessible separator. */
export function ResizeHandle() {
  const width = useUiStore((s) => s.sidebarWidthPx);
  const setWidth = useUiStore((s) => s.setSidebarWidth);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: globalThis.PointerEvent) => setWidth(Math.max(MIN, Math.min(maxW(), ev.clientX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') setWidth(Math.max(MIN, width - 16));
    else if (e.key === 'ArrowRight') setWidth(Math.min(maxW(), width + 16));
    else if (e.key === 'Home') setWidth(MIN);
    else if (e.key === 'End') setWidth(maxW());
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="resize-handle"
      style={{ left: 'var(--sidebar-w)' }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize conversation list"
      aria-valuemin={MIN}
      aria-valuemax={maxW()}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setWidth(340)}
    />
  );
}
