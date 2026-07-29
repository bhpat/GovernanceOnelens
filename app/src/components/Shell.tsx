import { useEffect, useState } from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Tooltip,
  Toaster,
  mergeClasses,
} from '@fluentui/react-components';
import { SignOut20Regular } from '@fluentui/react-icons';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { APP_TOASTER_ID } from '@/hooks/useAppToast';
import { NAV } from '@/lib/nav';
import { sectionAccentFor } from '@/lib/sectionTheme';
import { relTime } from '@/lib/utils';
import { getConnectors } from '@/services/connectors';

const useStyles = makeStyles({
  root: { display: 'flex', height: '100%', backgroundColor: tokens.colorNeutralBackground2 },
  sidebar: {
    width: '244px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    '@media (max-width: 960px)': { width: '64px' },
  },
  brand: { display: 'flex', alignItems: 'center', gap: '10px', padding: '18px 20px' },
  brandText: {
    '@media (max-width: 960px)': { display: 'none' },
  },
  brandMark: {
    width: '32px',
    height: '32px',
    flexShrink: 0,
    display: 'block',
  },
  nav: { flex: 1, padding: '4px 12px', display: 'flex', flexDirection: 'column', gap: '2px' },
  navGroupLabel: {
    padding: '10px 12px 4px',
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: tokens.colorNeutralForeground4,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'background-color 150ms ease, color 150ms ease',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, color: tokens.colorNeutralForeground1 },
  },
  navLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    '@media (max-width: 960px)': { display: 'none' },
  },
  navItemActive: {
    fontWeight: tokens.fontWeightBold,
  },
  footer: {
    padding: '12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  freshness: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    '@media (max-width: 960px)': { justifyContent: 'center', padding: '10px 8px' },
  },
  freshnessDot: { width: '7px', height: '7px', borderRadius: '999px', flexShrink: 0 },
  freshnessText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    '@media (max-width: 960px)': { display: 'none' },
  },
  userInfo: { minWidth: 0, display: 'flex', flexDirection: 'column', '@media (max-width: 960px)': { display: 'none' } },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  signout: {
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, color: tokens.colorNeutralForeground1 },
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground2,
  },
});

export function Shell() {
  const styles = useStyles();
  const { signOut, user } = useAuth();
  const location = useLocation();

  return (
    <div className={styles.root}>
      <Toaster toasterId={APP_TOASTER_ID} />
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src="/onelens-mark.svg" width={32} height={32} alt="Governance OneLens" className={styles.brandMark} />
          <div className={styles.brandText}>
            <Text as="p" block weight="semibold" size={300}>
              Governance OneLens
            </Text>
            <Text as="p" block size={100} style={{ color: tokens.colorNeutralForeground3 }}>
              Fabric governance
            </Text>
          </div>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navGroupLabel}>Explore</div>
          {NAV.map(({ to, label, icon, end }) => {
            const isActive = end ? location.pathname === to : location.pathname.startsWith(to);
            const { accent, soft } = sectionAccentFor(to);
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive: navIsActive }) =>
                  mergeClasses(styles.navItem, navIsActive && styles.navItemActive)
                }
                style={isActive ? { backgroundColor: soft, color: accent } : undefined}
              >
                {icon}
                <span className={styles.navLabel}>{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <FreshnessBadge />
        <div className={styles.footer}>
          <div className={styles.userInfo}>
            <Text block size={200} weight="semibold" className={styles.ellipsis}>
              {user?.name ?? 'Signed in'}
            </Text>
            <Text
              block
              size={100}
              className={styles.ellipsis}
              style={{ color: tokens.colorNeutralForeground3 }}
            >
              {user?.email}
            </Text>
          </div>
          <Tooltip content="Sign out" relationship="label">
            <button className={styles.signout} onClick={() => void signOut()} aria-label="Sign out">
              <SignOut20Regular />
            </button>
          </Tooltip>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

/** Fetched once per authenticated session (Shell mounts once, not per route) —
 * a lightweight, persistent "is this data fresh" trust signal, appropriate for
 * a governance tool where staleness itself is a governance risk. */
function useFreshness() {
  const [state, setState] = useState<{ lastSeen?: string; itemCount?: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getConnectors()
      .then((rows) => {
        if (cancelled) return;
        const primary = rows.find((c) => c.kind === 'collection' && c.status === 'connected');
        if (primary) setState({ lastSeen: primary.lastSeen, itemCount: primary.itemCount });
      })
      .catch(() => {
        /* non-critical — the badge just stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function FreshnessBadge() {
  const styles = useStyles();
  const freshness = useFreshness();
  if (!freshness?.lastSeen) return null;

  const hours = (Date.now() - new Date(freshness.lastSeen).getTime()) / 3_600_000;
  const color = hours <= 26
    ? tokens.colorStatusSuccessForeground1
    : hours <= 48
      ? tokens.colorStatusWarningForeground1
      : tokens.colorStatusDangerForeground1;
  const label = `Scanned ${relTime(freshness.lastSeen)}${freshness.itemCount ? ` · ${freshness.itemCount} items` : ''}`;

  return (
    <Tooltip content={`Governance data as of ${new Date(freshness.lastSeen).toLocaleString()}`} relationship="label">
      <div className={styles.freshness}>
        <span className={styles.freshnessDot} style={{ backgroundColor: color }} />
        <span className={styles.freshnessText}>{label}</span>
      </div>
    </Tooltip>
  );
}
