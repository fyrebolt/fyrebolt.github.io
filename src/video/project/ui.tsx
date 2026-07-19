// ===== Shared presentational primitives for the editor's control panels =====

import type { ReactNode } from 'react';

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-[var(--color-text-secondary)] mb-1.5">{label}</div>
      {children}
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-[var(--color-text-secondary)]">
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-9 rounded-md bg-transparent border border-[var(--color-glass-border)] p-0.5"
      />
    </label>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[var(--color-primary-green)]" />
      <span className="leading-tight">
        <span className="block text-xs font-medium">{label}</span>
        {hint && <span className="block text-[10px] text-[var(--color-text-muted)]">{hint}</span>}
      </span>
    </label>
  );
}

/** A grid of exclusive choice buttons (used for ratio / align / mode pickers). */
export function ChoiceGrid<T extends string>({
  cols = 3,
  value,
  options,
  onChange,
}: {
  cols?: number;
  value: T;
  options: { key: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-1 py-2 rounded-md text-[11px] border text-left ${
            value === o.key ? 'border-[var(--color-primary-green)] bg-[var(--color-glass-hover)]' : 'border-[var(--color-glass-border)]'
          }`}
        >
          <div className="font-semibold">{o.label}</div>
          {o.hint && <div className="text-[10px] text-[var(--color-text-muted)]">{o.hint}</div>}
        </button>
      ))}
    </div>
  );
}
