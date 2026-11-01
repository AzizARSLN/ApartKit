import { useState } from "react";
import { formatMoney } from "../lib/api";

export type MonthlyRow = { period: string; charged: string; collected: string; spent: string };

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function monthLabel(period: string): string {
  return MONTHS[Number(period.slice(5)) - 1] ?? period;
}

export function MonthlyChart({ rows }: { rows: MonthlyRow[] }) {
  const [active, setActive] = useState<MonthlyRow | null>(null);
  const max = Math.max(1, ...rows.flatMap((r) => [Number(r.charged), Number(r.collected)]));

  return (
    <figure className="m-0">
      <figcaption className="flex flex-wrap items-center gap-4 text-sm mb-3">
        <span className="inline-flex items-center gap-1.5">
          <i className="chart-key chart-charged" /> Tahakkuk
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="chart-key chart-collected" /> Tahsilat
        </span>
        <span className="muted ml-auto min-h-5" aria-live="polite">
          {active
            ? `${active.period}: tahakkuk ${formatMoney(active.charged)} · tahsilat ${formatMoney(active.collected)}`
            : "Ay üzerine gelin"}
        </span>
      </figcaption>
      <div className="monthly-chart" onMouseLeave={() => setActive(null)}>
        {rows.map((row) => (
          <button
            key={row.period}
            type="button"
            className="monthly-group"
            aria-label={`${row.period}: tahakkuk ${formatMoney(row.charged)}, tahsilat ${formatMoney(row.collected)}`}
            onMouseEnter={() => setActive(row)}
            onFocus={() => setActive(row)}
          >
            <span className="monthly-bars">
              <i className="chart-charged" style={{ height: `${(Number(row.charged) / max) * 100}%` }} />
              <i className="chart-collected" style={{ height: `${(Number(row.collected) / max) * 100}%` }} />
            </span>
            <span className="monthly-label">{monthLabel(row.period)}</span>
          </button>
        ))}
      </div>
    </figure>
  );
}
