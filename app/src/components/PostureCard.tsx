import { ReactNode } from 'react';
import { Card } from '@tremor/react';
import { ChevronRight16Regular } from '@fluentui/react-icons';
import type { PostureSignal, HistoryPoint } from '@/services/observability';
import { trendOf } from '@/services/observability';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

/**
 * PostureCard — Tremor Card wrapper for ObservabilityPage posture metrics.
 * Displays: icon + value + label + trend sparkline + optional drill link
 */
export function PostureCard({
  posture,
  icon,
  label,
  points,
  color,
  warn,
  onDrill,
}: {
  posture: PostureSignal;
  icon: ReactNode;
  label: string;
  points?: HistoryPoint[];
  color: string;
  warn?: boolean;
  onDrill?: () => void;
}) {
  const { delta } = trendOf(points);
  const vals = (points ?? []).map((p) => p.value);

  const trendMessage =
    delta === undefined
      ? vals.length
        ? 'baseline'
        : 'no history yet'
      : Math.abs(delta) < 0.05
        ? 'no change since last scan'
        : `${fmtDelta(delta)} since last scan`;

  return (
    <Card
      className={`relative flex flex-col gap-2 p-4 transition-all ${onDrill ? 'cursor-pointer hover:border-tremor-brand-subtle hover:shadow-tremor-card' : ''}`}
      onClick={onDrill}
      role={onDrill ? 'button' : undefined}
      tabIndex={onDrill ? 0 : undefined}
      onKeyDown={
        onDrill
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onDrill();
              }
            }
          : undefined
      }
    >
      {/* Top row: icon + warning badge */}
      <div className="flex items-center justify-between">
        <div className="text-tremor-content">{icon}</div>
        {warn && (
          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
            check
          </span>
        )}
      </div>

      {/* Value */}
      <div className="text-tremor-metric font-bold text-tremor-content-strong">
        {Number.isInteger(posture.value) ? posture.value : posture.value.toFixed(1)}
      </div>

      {/* Label */}
      <p className="text-tremor-default text-tremor-content">{label}</p>

      {/* Trend sparkline */}
      <div className="flex flex-col gap-1">
        <span className="text-tremor-default text-tremor-content-subtle">{trendMessage}</span>
        {vals.length >= 2 && (
          <div className="h-6">
            <ResponsiveContainer width="100%" height={26}>
              <AreaChart data={vals.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={color}
                  fill={color}
                  fillOpacity={0.14}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Drill link */}
      {onDrill && (
        <div className="mt-1 flex items-center gap-1 text-tremor-default font-semibold text-tremor-brand">
          View items
          <ChevronRight16Regular style={{ width: 16, height: 16 }} />
        </div>
      )}
    </Card>
  );
}

/**
 * Format a raw absolute delta since the previous scan (e.g., +13 or -2).
 * Posture signals are counts (items, workspaces, edges, …), not percentages —
 * this must NOT multiply by 100 / append "%" (that treats a count difference
 * like "+13 more items" as if it were a 1300% change).
 */
function fmtDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  const v = Number.isInteger(delta) ? String(delta) : delta.toFixed(1);
  return `${sign}${v}`;
}
