import type { CatalogItem } from '@/services/catalog';

/**
 * Shared governance-health grading scale.
 *
 * Previously Home ({@link module:components/CommandCenterHome}), Lineage
 * ({@link module:pages/LineageExplorerPage}), and Observability each hardcoded
 * their OWN good/warn cutoffs (70/40, 66/33, and 95/50 respectively) — the
 * exact same coverage percentage could render green on one tab and red on
 * another. Centralizing here so every surface agrees on what "healthy" means.
 */
export const HEALTH_THRESHOLDS = { good: 70, warn: 40 } as const;

export type HealthStatus = 'success' | 'warning' | 'error';

/** Grade a 0-100 percentage into a Fluent-compatible status token (drives
 * `tokens.colorStatus*` lookups and Fluent `ProgressBar`/`Badge` `color` props). */
export function healthStatus(pct: number): HealthStatus {
  return pct >= HEALTH_THRESHOLDS.good ? 'success' : pct >= HEALTH_THRESHOLDS.warn ? 'warning' : 'error';
}

/** Raw hex per status — exported so callers that need the exact same success/
 * warning/error color as a standalone constant (not derived from a
 * percentage) can reuse it instead of re-hardcoding a duplicate literal. */
export const HEALTH_HEX: Record<HealthStatus, string> = {
  success: '#107c41',
  warning: '#c19c00',
  error: '#ca5010',
};

/** Grade a 0-100 percentage into a raw hex color, for rendering contexts that
 * can't consume Fluent design tokens (SVG gauge strokes, Recharts fills). */
export function healthColor(pct: number): string {
  return HEALTH_HEX[healthStatus(pct)];
}

/** Shared brand accent color (previously redefined ad hoc as a local
 * `const BRAND = '#0f6cbd'` in multiple files). */
export const BRAND = '#0f6cbd';

/**
 * The 4 core per-item governance pillars: has an owner, has a description,
 * carries a sensitivity label, and has a real endorsement (Promoted/
 * Certified — not the literal string "None"). This is the SINGLE canonical
 * governance-completeness formula for Governance OneLens.
 *
 * This exact 4-line formula used to be independently copy-pasted in FOUR
 * different files (CommandCenterHome, HomePage, observabilityAnalysis, plus
 * a differently-shaped 5th copy in HomePage's GovernanceCell tooltip) — a
 * real drift risk, and the direct cause of a real bug: Observability's
 * headline "Coverage score" was computed a totally different way (averaging
 * ALL 6 backend CoverageMetric rows, two of which — domainAssigned scoped to
 * workspaces, lineageComplete scoped to a lineage-eligible subset — have
 * different denominators than the other 4 item-level ones), so it disagreed
 * with Catalog's "% governed" by several points even though both claimed to
 * describe the same thing. Every headline governance percentage (Catalog's
 * hero gauge/KPIs, Observability's Coverage score, the results-table
 * Governance column + per-group average, and the workspace/domain/type
 * rollups) MUST derive from this function (via {@link governanceScore}) so
 * the numbers can never silently disagree again.
 */
export function govPillars(i: CatalogItem): number {
  return (i.sensitivityLabel ? 1 : 0) + (i.description ? 1 : 0) + (i.owner ? 1 : 0) + (i.endorsement && i.endorsement !== 'None' ? 1 : 0);
}

/** Governance score (0-100): average pillar completeness across the given
 * items. Pass the full catalog for the tenant-wide headline score, or a
 * filtered subset for a per-workspace/domain/type rollup. */
export function governanceScore(items: CatalogItem[]): number {
  if (!items.length) return 0;
  return Math.round((items.reduce((n, i) => n + govPillars(i), 0) / (items.length * 4)) * 100);
}
