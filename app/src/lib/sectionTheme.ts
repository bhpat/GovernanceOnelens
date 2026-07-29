/**
 * Per-section brand accents — the "color transitioning between tabs" system.
 *
 * Before this module, the ENTIRE app reused one flat brand blue (`BRAND` in
 * `health.ts`) everywhere; the only other color story was the governance
 * health scale (green/amber/orange — semantic, not brand identity) and two
 * separately-defined, slightly-inconsistent categorical arrays (Lineage's
 * `WS_COLORS`, Observability's `PIE_COLORS`). Every nav tab looked the same.
 *
 * Deliberately cool-hue-only (blue/teal/cyan/indigo/violet/slate) — NEVER
 * green/amber/orange/red, which stay reserved for `health.ts`'s success/
 * warning/error grading. A user should never wonder "is this green dot a
 * healthy-governance signal, or just this tab's brand color?" — the two
 * color languages must never overlap in hue family.
 */

export interface SectionAccent {
  /** Solid accent — icon badges, active nav state, chart primary series, links. */
  accent: string;
  /** Very light tint — icon-badge backgrounds, subtle section washes. */
  soft: string;
  /** Mid-tone border — card/badge outlines that need to read as "this section". */
  border: string;
}

/** Keyed by route path (exact match against `NAV`'s `to`). */
export const SECTION_ACCENTS: Record<string, SectionAccent> = {
  '/': { accent: '#2563EB', soft: '#EFF6FF', border: '#BFDBFE' }, // Catalog — blue (the front door)
  '/ask': { accent: '#7C3AED', soft: '#F5F3FF', border: '#DDD6FE' }, // Ask OneLens — violet (AI/intelligence)
  '/observability': { accent: '#0D9488', soft: '#F0FDFA', border: '#99F6E4' }, // Observability — teal (vitals/pulse)
  '/lineage': { accent: '#0891B2', soft: '#ECFEFF', border: '#A5F3FC' }, // Lineage — cyan (flow/movement)
  '/workspaces': { accent: '#4F46E5', soft: '#EEF2FF', border: '#C7D2FE' }, // Workspaces — indigo (structure)
  '/connectors': { accent: '#0284C7', soft: '#F0F9FF', border: '#BAE6FD' }, // Connectors — sky (plumbing)
  '/settings': { accent: '#475569', soft: '#F8FAFC', border: '#E2E8F0' }, // Settings — slate (deliberately calm)
};

const DEFAULT_ACCENT: SectionAccent = SECTION_ACCENTS['/'];

/** Longest-prefix match so nested/child routes (if any are added later)
 * inherit their parent tab's accent without needing an exact entry. */
export function sectionAccentFor(pathname: string): SectionAccent {
  let best: { path: string; value: SectionAccent } | null = null;
  for (const [path, value] of Object.entries(SECTION_ACCENTS)) {
    if (pathname === path || (path !== '/' && pathname.startsWith(path))) {
      if (!best || path.length > best.path.length) best = { path, value };
    }
  }
  return best?.value ?? DEFAULT_ACCENT;
}

/**
 * Shared 12-color categorical palette — replaces both Lineage's `WS_COLORS`
 * and Observability's `PIE_COLORS` (previously two separately-defined,
 * slightly-inconsistent arrays) so "this workspace's dot" and "this chart
 * slice" are drawn from the same coordinated family everywhere. The first 7
 * entries intentionally match the 7 section accents above (so a workspace or
 * chip that happens to land on, say, the same hue as the Lineage tab visually
 * "rhymes" rather than clashing), extended with 5 more coordinated hues for
 * charts/lists that need more than 7 distinct categories.
 */
export const CATEGORICAL_PALETTE = [
  '#2563EB', // blue
  '#0D9488', // teal
  '#7C3AED', // violet
  '#0891B2', // cyan
  '#4F46E5', // indigo
  '#0284C7', // sky
  '#DB2777', // pink
  '#059669', // emerald
  '#D97706', // amber
  '#9333EA', // purple
  '#0EA5E9', // light blue
  '#65A30D', // lime
];
