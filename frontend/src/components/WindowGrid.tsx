import { memo } from "react";

const WINDOW_COUNT = 968;
const BASE_LIT_PERCENT = 7;
const MAX_LIT_PERCENT = 45;

function windowHash(index: number): number {
  const mixed = Math.imul(index + 1, 2654435761);
  return ((mixed ^ (mixed >>> 15)) >>> 0) % 1000;
}

const hashes = Array.from({ length: WINDOW_COUNT }, (_, index) => windowHash(index));

function WindowGridBase({ level }: { level: number }) {
  const threshold = Math.min(BASE_LIT_PERCENT + level, MAX_LIT_PERCENT) * 10;
  return (
    <div className="login-windows" aria-hidden>
      {hashes.map((hash, index) => (
        <i key={index} className={hash < threshold ? (hash % 6 === 0 ? "is-warm" : "is-lit") : undefined} />
      ))}
    </div>
  );
}

export const WindowGrid = memo(WindowGridBase);
