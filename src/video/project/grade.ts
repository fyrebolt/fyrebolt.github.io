// ===== Colour grade: brightness / contrast / saturation adjustment =====
//
// A plain-data grade applied through the canvas `ctx.filter` string, so the SAME
// adjustment lands identically in live preview and the recorded export (both go
// through the compositor's one draw path). Values are MULTIPLIERS where 1 = the
// unchanged image, matching CSS filter units (brightness(1) contrast(1)
// saturate(1) is the identity). Absent/undefined == neutral, so existing clips
// and projects are never affected until someone edits a grade.
//
// A grade can live in two places (both optional, both compose the same way):
//   - per VideoClip: graded onto that clip's base frame only.
//   - per Project:   a global grade over the WHOLE composited output (base +
//                    every overlay), applied as a final pass.

export interface ColorGrade {
  /** Overall lightness. 1 = unchanged, <1 darker, >1 brighter. */
  brightness: number;
  /** Tonal contrast. 1 = unchanged, <1 flatter, >1 punchier. */
  contrast: number;
  /** Colour intensity. 0 = greyscale, 1 = unchanged, >1 more saturated. */
  saturation: number;
}

export const NEUTRAL_GRADE: ColorGrade = { brightness: 1, contrast: 1, saturation: 1 };

/** Editable slider range for every grade channel. */
export const GRADE_MIN = 0;
export const GRADE_MAX = 2;

export function clampGrade(v: number): number {
  if (!isFinite(v)) return 1;
  return Math.max(GRADE_MIN, Math.min(GRADE_MAX, v));
}

/** True when the grade is (near) the identity, so the draw can skip it entirely. */
export function isNeutralGrade(g: ColorGrade | undefined | null): boolean {
  if (!g) return true;
  return (
    Math.abs(g.brightness - 1) < 1e-3 &&
    Math.abs(g.contrast - 1) < 1e-3 &&
    Math.abs(g.saturation - 1) < 1e-3
  );
}

/**
 * The CSS/canvas `ctx.filter` fragment for a grade, or '' when neutral. Callers
 * compose it with any other filter operations (e.g. the blur fill mode) by
 * concatenating fragments separated by spaces.
 */
export function gradeFilter(g: ColorGrade | undefined | null): string {
  if (isNeutralGrade(g)) return '';
  const b = clampGrade(g!.brightness);
  const c = clampGrade(g!.contrast);
  const s = clampGrade(g!.saturation);
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

export interface GradePreset {
  id: string;
  label: string;
  grade: ColorGrade;
}

/**
 * Curated preset "looks" — pre-filled brightness/contrast/saturation values (no
 * LUT). Selecting one just sets the sliders; the user can tweak further after.
 * Distinguishable within the three channels: warm reads bright + saturated, cool
 * dimmer + muted, vintage faded/low-contrast, punchy high contrast + colour.
 */
export const GRADE_PRESETS: GradePreset[] = [
  { id: 'none', label: 'Neutral', grade: { brightness: 1, contrast: 1, saturation: 1 } },
  { id: 'warm', label: 'Warm', grade: { brightness: 1.08, contrast: 1.05, saturation: 1.22 } },
  { id: 'cool', label: 'Cool', grade: { brightness: 0.97, contrast: 1.08, saturation: 0.82 } },
  { id: 'vintage', label: 'Vintage', grade: { brightness: 1.05, contrast: 0.88, saturation: 0.7 } },
  { id: 'punchy', label: 'Punchy', grade: { brightness: 1.0, contrast: 1.28, saturation: 1.32 } },
  { id: 'noir', label: 'B&W', grade: { brightness: 1.02, contrast: 1.15, saturation: 0 } },
];

/** The preset whose values match `g` exactly, if any (for highlighting the active chip). */
export function matchPreset(g: ColorGrade | undefined | null): string | null {
  const grade = g ?? NEUTRAL_GRADE;
  const hit = GRADE_PRESETS.find(
    (p) =>
      Math.abs(p.grade.brightness - grade.brightness) < 1e-3 &&
      Math.abs(p.grade.contrast - grade.contrast) < 1e-3 &&
      Math.abs(p.grade.saturation - grade.saturation) < 1e-3,
  );
  return hit ? hit.id : null;
}
