import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  addBlankColumn,
  buildPeriodReportHtml,
  defaultReportLayout,
  moveColumn,
  patchColumn,
  removeColumn,
  REPORT_TOKENS,
  type ReportInput,
  type ReportLayout,
} from "../lib/periodReport";

type Props = {
  input: ReportInput;
  layout: ReportLayout;
  onSave: (layout: ReportLayout) => void;
  onPrint: (layout: ReportLayout) => void;
  onClose: () => void;
};

export function ReportEditorModal({ input, layout, onSave, onPrint, onClose }: Props) {
  const [draft, setDraft] = useState(layout);
  const [newColumn, setNewColumn] = useState("");
  const previewHtml = useMemo(() => buildPeriodReportHtml(input, draft), [input, draft]);
  const visibleCount = draft.columns.filter((c) => c.visible).length;

  function addColumn() {
    const header = newColumn.trim();
    if (!header) return;
    setDraft(addBlankColumn(draft, header, `blank-${Date.now()}`));
    setNewColumn("");
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Raporu düzenle">
      <div className="modal-panel report-editor">
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--line)]">
          <div>
            <h2 className="text-xl font-semibold">Raporu düzenle</h2>
            <p className="muted text-sm">{input.periodLabel} · Değişiklikler sağda anında görünür.</p>
          </div>
          <button className="btn btn-ghost btn-icon" type="button" aria-label="Kapat" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="report-editor-body">
          <aside className="report-editor-side space-y-5">
            <section className="space-y-2">
              <h3 className="section-label">Başlık</h3>
              <input
                className="input"
                aria-label="Rapor başlığı"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <input
                className="input"
                aria-label="Rapor alt başlığı"
                value={draft.subtitle}
                onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              />
            </section>

            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="section-label">Kolonlar</h3>
                <span className="muted text-xs">{visibleCount} görünür</span>
              </div>
              <ul className="space-y-2">
                {draft.columns.map((column, index) => (
                  <li key={column.id} className={`column-row ${column.visible ? "" : "is-off"}`}>
                    <input
                      type="checkbox"
                      aria-label={`${column.header.split("\n")[0]} kolonunu göster`}
                      checked={column.visible}
                      onChange={(e) =>
                        setDraft(patchColumn(draft, column.id, { visible: e.target.checked }))
                      }
                    />
                    <textarea
                      className="input column-header-input"
                      aria-label="Kolon başlığı"
                      rows={Math.min(3, column.header.split("\n").length)}
                      value={column.header}
                      onChange={(e) =>
                        setDraft(patchColumn(draft, column.id, { header: e.target.value }))
                      }
                    />
                    <div className="flex flex-col gap-1">
                      <button
                        className="btn btn-ghost btn-icon-sm"
                        type="button"
                        aria-label="Yukarı taşı"
                        disabled={index === 0}
                        onClick={() => setDraft(moveColumn(draft, column.id, -1))}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="btn btn-ghost btn-icon-sm"
                        type="button"
                        aria-label="Aşağı taşı"
                        disabled={index === draft.columns.length - 1}
                        onClick={() => setDraft(moveColumn(draft, column.id, 1))}
                      >
                        <ArrowDown size={14} />
                      </button>
                      {column.source === "blank" ? (
                        <button
                          className="btn btn-ghost btn-icon-sm"
                          type="button"
                          aria-label="Kolonu kaldır"
                          onClick={() => setDraft(removeColumn(draft, column.id))}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="Yeni boş kolon, örn. Teslim tarihi"
                  value={newColumn}
                  onChange={(e) => setNewColumn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addColumn();
                  }}
                />
                <button className="btn btn-ghost" type="button" disabled={!newColumn.trim()} onClick={addColumn}>
                  <Plus size={16} /> Ekle
                </button>
              </div>
              <p className="muted text-xs">
                Toplam tutar, gizlenen kolonlar dahil aidat, gecikme, yakıt ve diğer tutarlardan hesaplanır.
                Başlıklarda şu alanlar otomatik dolar: {REPORT_TOKENS.join(" ")}
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="section-label">Seçenekler</h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.showTotals}
                  onChange={(e) => setDraft({ ...draft, showTotals: e.target.checked })}
                />
                Toplam satırını göster
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.showNotes}
                  onChange={(e) => setDraft({ ...draft, showNotes: e.target.checked })}
                />
                Alt açıklamayı göster
              </label>
              {draft.showNotes ? (
                <textarea
                  className="input"
                  aria-label="Alt açıklama"
                  rows={6}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              ) : null}
            </section>
          </aside>

          <iframe className="report-preview" title="Rapor önizleme" sandbox="" srcDoc={previewHtml} />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-[var(--line)]">
          <button className="btn btn-ghost" type="button" onClick={() => setDraft(defaultReportLayout())}>
            <RotateCcw size={16} /> Varsayılana dön
          </button>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" type="button" disabled={visibleCount === 0} onClick={() => onSave(draft)}>
              Kaydet
            </button>
            <button className="btn" type="button" disabled={visibleCount === 0} onClick={() => onPrint(draft)}>
              Kaydet ve yazdır
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
