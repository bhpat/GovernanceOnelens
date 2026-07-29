import type { ReactNode } from 'react';
import { makeStyles, tokens, Text, mergeClasses } from '@fluentui/react-components';
import { useLocation } from 'react-router-dom';

import { sectionAccentFor } from '@/lib/sectionTheme';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '18px 32px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  left: { display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 },
  iconBadge: {
    width: '38px',
    height: '38px',
    flexShrink: 0,
    borderRadius: tokens.borderRadiusLarge,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
  },
  text: { minWidth: 0 },
  actions: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
});

/**
 * Shared page header — icon badge (tinted with this route's section accent,
 * see `lib/sectionTheme.ts`) + title + subtitle, with an optional trailing
 * actions slot. Replaces the plain title-only header bar that 6 of the app's
 * 7 tabs used to render identically (no color, no icon) — this is the main
 * lever for "color transitions as you move between tabs": each page now
 * opens with a distinct, coordinated accent instead of the same flat chrome.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const styles = useStyles();
  const { pathname } = useLocation();
  const { accent, soft } = sectionAccentFor(pathname);

  return (
    <div className={mergeClasses(styles.root, className)}>
      <div className={styles.left}>
        <div className={styles.iconBadge} style={{ backgroundColor: soft, color: accent }}>
          {icon}
        </div>
        <div className={styles.text}>
          <Text as="h1" block size={600} weight="semibold">{title}</Text>
          {subtitle && (
            <Text as="p" block size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {subtitle}
            </Text>
          )}
        </div>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
