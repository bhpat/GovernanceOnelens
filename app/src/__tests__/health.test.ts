import { describe, expect, it } from 'vitest';

import { HEALTH_THRESHOLDS, healthColor, healthStatus, govPillars, governanceScore } from '@/lib/health';
import type { CatalogItem } from '@/services/catalog';

// Regression guard for the "same % renders as a different color on every
// page" bug: CommandCenterHome, LineageExplorerPage, and ObservabilityPage
// each used to hardcode their own (different) good/warn cutoffs. These tests
// pin the single shared scale so a future edit can't silently reintroduce
// per-file divergence.
describe('health', () => {
  it('grades at/above the good threshold as success', () => {
    expect(healthStatus(HEALTH_THRESHOLDS.good)).toBe('success');
    expect(healthStatus(100)).toBe('success');
  });

  it('grades between warn and good as warning', () => {
    expect(healthStatus(HEALTH_THRESHOLDS.warn)).toBe('warning');
    expect(healthStatus(HEALTH_THRESHOLDS.good - 1)).toBe('warning');
  });

  it('grades below warn as error', () => {
    expect(healthStatus(HEALTH_THRESHOLDS.warn - 1)).toBe('error');
    expect(healthStatus(0)).toBe('error');
  });

  it('healthColor stays consistent with healthStatus', () => {
    expect(healthColor(90)).toBe('#107c41');
    expect(healthColor(50)).toBe('#c19c00');
    expect(healthColor(10)).toBe('#ca5010');
  });
});

// Regression guard for the "Catalog says 29% governed but Observability says
// 34% Coverage score" bug: this exact 4-pillar formula used to be
// independently copy-pasted across several files, and Observability's
// headline number separately averaged in 2 extra metrics with different
// denominators. Pinning both functions here so no future edit can silently
// reintroduce a page-to-page mismatch.
describe('govPillars / governanceScore', () => {
  const item = (over: Partial<CatalogItem>): CatalogItem => ({ owner: undefined, description: undefined, sensitivityLabel: undefined, endorsement: undefined, ...over } as CatalogItem);

  it('counts each of the 4 pillars independently', () => {
    expect(govPillars(item({}))).toBe(0);
    expect(govPillars(item({ owner: 'a@b.com' }))).toBe(1);
    expect(govPillars(item({ owner: 'a@b.com', description: 'x' }))).toBe(2);
    expect(govPillars(item({ owner: 'a@b.com', description: 'x', sensitivityLabel: 'Confidential' }))).toBe(3);
    expect(govPillars(item({ owner: 'a@b.com', description: 'x', sensitivityLabel: 'Confidential', endorsement: 'Certified' }))).toBe(4);
  });

  it('treats the literal endorsement value "None" as not endorsed', () => {
    expect(govPillars(item({ endorsement: 'None' }))).toBe(0);
  });

  it('averages pillar completeness across all items, 0-100', () => {
    const items = [
      item({ owner: 'a', description: 'd', sensitivityLabel: 'l', endorsement: 'Certified' }), // 4/4
      item({}), // 0/4
    ];
    expect(governanceScore(items)).toBe(50);
  });

  it('returns 0 for an empty item list (never divides by zero)', () => {
    expect(governanceScore([])).toBe(0);
  });
});
