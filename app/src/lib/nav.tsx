import type { ReactNode } from 'react';
import {
  Grid20Regular,
  DataTrending20Regular,
  Group20Regular,
  PlugConnected20Regular,
  Settings20Regular,
  Flow20Regular,
  Sparkle20Regular,
} from '@fluentui/react-icons';

export interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
  end: boolean;
}

/** Primary navigation — the single source of truth for Shell's sidebar. */
export const NAV: NavEntry[] = [
  { to: '/', label: 'Catalog', icon: <Grid20Regular />, end: true },
  { to: '/ask', label: 'Ask OneLens', icon: <Sparkle20Regular />, end: false },
  { to: '/observability', label: 'Observability', icon: <DataTrending20Regular />, end: false },
  { to: '/lineage', label: 'Lineage', icon: <Flow20Regular />, end: false },
  { to: '/workspaces', label: 'Workspaces', icon: <Group20Regular />, end: false },
  { to: '/connectors', label: 'Connectors', icon: <PlugConnected20Regular />, end: false },
  { to: '/settings', label: 'Settings', icon: <Settings20Regular />, end: false },
];
