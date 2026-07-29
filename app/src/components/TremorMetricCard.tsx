import { Card } from '@tremor/react';
import { ReactNode } from 'react';

/**
 * TremorMetricCard — wrapper combining shadcn/ui Card styling
 * with Tremor Metric content (value, label, delta, status).
 * Designed for KPI display across HomePage, ObservabilityPage, WorkspacesPage.
 */
interface TremorMetricCardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaType?: 'increase' | 'decrease' | 'neutral';
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
}

export function TremorMetricCard({
  label,
  value,
  delta,
  deltaType,
  icon,
  onClick,
  href,
}: TremorMetricCardProps) {
  const isClickable = onClick || href;
  const buttonClass = isClickable
    ? 'cursor-pointer hover:border-tremor-brand-subtle hover:shadow-tremor-card transition-all'
    : '';

  const content = (
    <Card className={buttonClass}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-tremor-default font-medium text-tremor-content">{label}</p>
          <p className="text-tremor-metric font-bold text-tremor-content-strong mt-1">{value}</p>
          {delta && (
            <div className="mt-2 flex items-center gap-1">
              <span
                className={`text-tremor-default font-semibold ${
                  deltaType === 'increase'
                    ? 'text-green-600'
                    : deltaType === 'decrease'
                      ? 'text-red-600'
                      : 'text-tremor-content'
                }`}
              >
                {delta}
              </span>
            </div>
          )}
        </div>
        {icon && <div className="ml-4 flex-shrink-0">{icon}</div>}
      </div>
    </Card>
  );

  if (href) {
    return (
      <a href={href} className="block text-inherit no-underline">
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="w-full text-left">
        {content}
      </button>
    );
  }

  return content;
}
