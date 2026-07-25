// ===== Caption layer property panel (font-boil / typewriter + word attachments) =====
// Ported from the classic CaptionsTool's selected-element controls; operates on a
// CaptionLayer via patch callbacks.

import { useState } from 'react';
import { Field, Slider } from '../ui';
import { ALL_FONTS, FONT_POOLS, poolById } from '../../captions/fonts';
import { captionWords, staticWindowOf } from '../../captions/types';
import type {
  Attachment,
  AttachmentType,
  BoilMode,
  Caption,
  CaptionEl,
  DeleteStyle,
  Legibility,
  TextAlign,
  TypewriterCaption,
} from '../../captions/types';
import type { CaptionLayer } from '../types';

const round2 = (n: number) => Math.round(n * 100) / 100;
const ATTACH_MIN = 0.2;

type CaptionPatch = Partial<Caption> | Partial<TypewriterCaption>;

interface Props {
  layer: CaptionLayer;
  duration: number;
  selectedAttachmentId: string | null;
  onEdit: (patch: CaptionPatch) => void;
  onAddAttachment: (type: AttachmentType) => void;
  onSelectAttachment: (attId: string) => void;
  onEditAttachment: (attId: string, patch: Partial<Attachment>) => void;
  onRemoveAttachment: (attId: string) => void;
  onRemove: () => void;
}

export default function CaptionPanel({
  layer,
  duration,
  selectedAttachmentId,
  onEdit,
  onAddAttachment,
  onSelectAttachment,
  onEditAttachment,
  onRemoveAttachment,
  onRemove,
}: Props) {
  const el = layer.el;
  const staticWin = staticWindowOf(el);
  const selectedAttachment = el.attachments.find((a) => a.id === selectedAttachmentId) ?? null;

  return (
    <>
      <Field label="Text (line breaks respected)">
        <textarea value={el.text} rows={3} onChange={(e) => onEdit({ text: e.target.value })} className="input resize-y" />
      </Field>

      {el.kind === 'boil' ? (
        <>
          <Field label={`Duration — ${round2(el.end - el.start)}s`}>
            <input
              type="number"
              min={0.2}
              max={Math.max(0.2, duration || 60)}
              step={0.1}
              value={round2(el.end - el.start)}
              onChange={(e) => {
                const d = Math.max(0.2, Number(e.target.value) || 0.2);
                onEdit({ end: el.start + d });
              }}
              className="input"
            />
          </Field>

          <Field label="Font boil">
            <div className="grid grid-cols-3 gap-1.5">
              {(['off', 'intro', 'continuous'] as BoilMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => onEdit({ boil: m })}
                  className={`px-1 py-2 rounded-md text-[11px] border capitalize ${
                    el.boil === m ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Font pool">
            <select
              value={el.pool}
              onChange={(e) => {
                const pool = e.target.value as Caption['pool'];
                // Keep the settle index in range for the new pool.
                onEdit({ pool, settleFontIndex: Math.min(el.settleFontIndex, poolById(pool).fonts.length - 1) });
              }}
              className="input"
            >
              {FONT_POOLS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Settle font">
            <select
              value={Math.min(el.settleFontIndex, poolById(el.pool).fonts.length - 1)}
              onChange={(e) => onEdit({ settleFontIndex: Number(e.target.value) })}
              className="input"
            >
              {poolById(el.pool).fonts.map((f, i) => (
                <option key={f.family} value={i}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>

          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={el.normalize} onChange={(e) => onEdit({ normalize: e.target.checked })} />
            Even sizing (normalize each font to a consistent height)
          </label>
        </>
      ) : (
        <>
          <Field label="Font">
            <select value={el.fontKey} onChange={(e) => onEdit({ fontKey: e.target.value })} className="input">
              {ALL_FONTS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} · {f.poolLabel}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Typing — ${el.typingDur.toFixed(1)}s`}>
              <input
                type="number"
                min={0.2}
                max={Math.max(0.2, duration || 60)}
                step={0.1}
                value={round2(el.typingDur)}
                onChange={(e) => onEdit({ typingDur: Math.max(0.2, Number(e.target.value) || 0.2) })}
                className="input"
              />
            </Field>
            <Field label={`Hold — ${el.holdDur.toFixed(1)}s`}>
              <input
                type="number"
                min={0.2}
                max={Math.max(0.2, duration || 60)}
                step={0.1}
                value={round2(el.holdDur)}
                onChange={(e) => onEdit({ holdDur: Math.max(0.2, Number(e.target.value) || 0.2) })}
                className="input"
              />
            </Field>
          </div>

          <Field label="Deletion">
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] mb-2">
              <input type="checkbox" checked={el.deleteEnabled} onChange={(e) => onEdit({ deleteEnabled: e.target.checked })} />
              Enable (otherwise it cuts at end of hold)
            </label>
            {el.deleteEnabled && (
              <>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  {([['char', 'Backspace'], ['selectAll', 'Select all']] as [DeleteStyle, string][]).map(([v, lbl]) => (
                    <button
                      key={v}
                      onClick={() => onEdit({ deleteStyle: v })}
                      className={`px-1 py-2 rounded-md text-[11px] border ${
                        el.deleteStyle === v ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={0.2}
                  max={Math.max(0.2, duration || 60)}
                  step={0.1}
                  value={round2(el.deleteDur)}
                  onChange={(e) => onEdit({ deleteDur: Math.max(0.2, Number(e.target.value) || 0.2) })}
                  className="input"
                />
                <div className="text-[10px] text-[var(--color-text-muted)] mt-1">Deletion duration (s)</div>
              </>
            )}
          </Field>
        </>
      )}

      <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
        <input type="checkbox" checked={el.sfx !== false} onChange={(e) => onEdit({ sfx: e.target.checked })} />
        {el.kind === 'boil' ? 'Riffle sound as it boils' : 'Key click sound while typing'} <span className="text-[var(--color-text-muted)]">(needs master SFX on)</span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Color">
          <input type="color" value={el.color} onChange={(e) => onEdit({ color: e.target.value })} className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5" />
        </Field>
        <Slider label={`Size — ${el.sizeScale.toFixed(1)}×`} min={0.5} max={2.5} step={0.1} value={el.sizeScale} onChange={(v) => onEdit({ sizeScale: v })} />
      </div>

      <Field label="Alignment">
        <div className="grid grid-cols-3 gap-1.5">
          {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
            <button
              key={a}
              onClick={() => onEdit({ align: a })}
              className={`px-1 py-2 rounded-md text-[11px] border capitalize ${
                el.align === a ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Legibility">
        <div className="grid grid-cols-3 gap-1.5">
          {(['outline', 'shadow', 'none'] as Legibility[]).map((l) => (
            <button
              key={l}
              onClick={() => onEdit({ legibility: l })}
              className={`px-1 py-2 rounded-md text-[11px] border capitalize ${
                el.legibility === l ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </Field>

      <AttachmentsSection
        cap={el}
        staticWin={staticWin}
        selected={selectedAttachment}
        onAdd={onAddAttachment}
        onSelect={onSelectAttachment}
        onUpdate={onEditAttachment}
        onRemove={onRemoveAttachment}
      />

      <button
        onClick={onRemove}
        className="w-full mt-1 px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-xs font-medium hover:bg-[rgba(255,80,80,0.08)]"
      >
        Remove {el.kind === 'typewriter' ? 'typewriter' : 'caption'}
      </button>
    </>
  );
}

// ---- word attachments ----

function AttachmentsSection({
  cap,
  staticWin,
  selected,
  onAdd,
  onSelect,
  onUpdate,
  onRemove,
}: {
  cap: CaptionEl;
  staticWin: { start: number; end: number } | null;
  selected: Attachment | null;
  onAdd: (type: AttachmentType) => void;
  onSelect: (attId: string) => void;
  onUpdate: (attId: string, patch: Partial<Attachment>) => void;
  onRemove: (attId: string) => void;
}) {
  const words = captionWords(cap.text);
  const swLen = staticWin ? staticWin.end - staticWin.start : 0;

  return (
    <div className="pt-3 mt-1 border-t border-[var(--color-glass-border)]">
      <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">Word attachments</div>

      {!staticWin ? (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {cap.kind === 'boil'
            ? 'Set boil to “off” or “intro” (with some duration) to underline/highlight static words.'
            : 'Give this typewriter a hold to underline/highlight static words.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button onClick={() => onAdd('underline')} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]">
              + Underline
            </button>
            <button onClick={() => onAdd('highlight')} className="px-2 py-2 rounded-md text-[11px] border border-[var(--color-glass-border)] hover:bg-[var(--color-glass-hover)]">
              + Highlight
            </button>
          </div>

          {cap.attachments.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-muted)]">None yet — add one, then pick the words it covers.</p>
          ) : (
            <div className="space-y-1 mb-1">
              {cap.attachments.map((a) => {
                const lo = Math.min(a.wordStart, a.wordEnd);
                const hi = Math.max(a.wordStart, a.wordEnd);
                const summary = words.slice(lo, hi + 1).join(' ') || '(no words)';
                const isSel = selected?.id === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => onSelect(a.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[11px] border ${
                      isSel ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-sm shrink-0 border border-black/20" style={{ background: a.color }} />
                    <span className="capitalize font-medium">{a.type}</span>
                    <span className="text-[var(--color-text-muted)] truncate">{summary}</span>
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <AttachmentEditor key={selected.id} att={selected} words={words} swLen={swLen} onUpdate={onUpdate} onRemove={onRemove} />
          )}
        </>
      )}
    </div>
  );
}

function AttachmentEditor({
  att,
  words,
  swLen,
  onUpdate,
  onRemove,
}: {
  att: Attachment;
  words: string[];
  swLen: number;
  onUpdate: (attId: string, patch: Partial<Attachment>) => void;
  onRemove: (attId: string) => void;
}) {
  const lo = Math.min(att.wordStart, att.wordEnd);
  const hi = Math.max(att.wordStart, att.wordEnd);
  const patch = (p: Partial<Attachment>) => onUpdate(att.id, p);
  const holdPct = Math.max(0, Math.round((1 - att.inFrac - att.outFrac) * 100));

  const [anchor, setAnchor] = useState(lo);
  const clickWord = (i: number, shift: boolean) => {
    if (shift) patch({ wordStart: Math.min(anchor, i), wordEnd: Math.max(anchor, i) });
    else {
      setAnchor(i);
      patch({ wordStart: i, wordEnd: i });
    }
  };

  const maxStart = Math.max(0, swLen - ATTACH_MIN);
  const maxDur = Math.max(ATTACH_MIN, swLen - att.startInStatic);

  return (
    <div className="mt-2 p-2.5 rounded-md bg-[var(--color-bg-elevated)] space-y-3">
      <Field label="Words (click one; shift-click another for a range)">
        {words.length === 0 ? (
          <span className="text-[11px] text-[var(--color-text-muted)]">Add text to the caption first.</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {words.map((w, i) => {
              const on = i >= lo && i <= hi;
              return (
                <button
                  key={i}
                  onClick={(e) => clickWord(i, e.shiftKey)}
                  className={`px-1.5 py-0.5 rounded text-[11px] ${on ? 'bg-[var(--color-primary-green)] text-black' : 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]'}`}
                >
                  {w}
                </button>
              );
            })}
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Color">
          <input type="color" value={att.color} onChange={(e) => patch({ color: e.target.value })} className="w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5" />
        </Field>
        {att.type === 'highlight' && (
          <Slider label={`Opacity — ${Math.round(att.opacity * 100)}%`} min={0.05} max={1} step={0.05} value={att.opacity} onChange={(v) => patch({ opacity: v })} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Start — ${att.startInStatic.toFixed(2)}s`}>
          <input
            type="number"
            min={0}
            max={round2(maxStart)}
            step={0.05}
            value={round2(att.startInStatic)}
            onChange={(e) => {
              const v = Math.max(0, Math.min(maxStart, Number(e.target.value) || 0));
              patch({ startInStatic: v, duration: Math.min(att.duration, Math.max(ATTACH_MIN, swLen - v)) });
            }}
            className="input"
          />
        </Field>
        <Field label={`Time — ${att.duration.toFixed(2)}s`}>
          <input
            type="number"
            min={ATTACH_MIN}
            max={round2(maxDur)}
            step={0.05}
            value={round2(att.duration)}
            onChange={(e) => patch({ duration: Math.max(ATTACH_MIN, Math.min(maxDur, Number(e.target.value) || ATTACH_MIN)) })}
            className="input"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Slider label={`Sweep in — ${Math.round(att.inFrac * 100)}%`} min={0} max={0.9} step={0.05} value={att.inFrac} onChange={(v) => patch({ inFrac: Math.min(v, 1 - att.outFrac) })} />
        <Slider label={`Sweep out — ${Math.round(att.outFrac * 100)}%`} min={0} max={0.9} step={0.05} value={att.outFrac} onChange={(v) => patch({ outFrac: Math.min(v, 1 - att.inFrac) })} />
      </div>

      <div className="text-[10px] text-[var(--color-text-muted)]">Hold {holdPct}%. Drag the marker on the timeline to move it; scrub to preview the sweep.</div>

      <button onClick={() => onRemove(att.id)} className="w-full px-3 py-2 rounded-md border border-[rgba(255,80,80,0.4)] text-[rgba(255,120,120,0.9)] text-[11px] font-medium hover:bg-[rgba(255,80,80,0.08)]">
        Remove attachment
      </button>
    </div>
  );
}
