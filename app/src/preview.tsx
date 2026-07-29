import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { createRoot } from 'react-dom/client';

import { LineageGraph } from '@/pages/LineageExplorerPage';
import { CommandCenterHome } from '@/components/CommandCenterHome';
import type { CatalogItem, WorkspaceRef, DomainRef } from '@/services/catalog';
import type { LineageEdge } from '@/services/lineage';

/* ------------------------------------------------------------------ shared */
const DOMAINS = [
  { canonicalId: 'dom:analytics', name: 'Sample Domain · Analytics' },
  { canonicalId: 'dom:platform', name: 'Sample Domain · Platform' },
] satisfies DomainRef[];
const WS = [
  { canonicalId: 'ws:sales', name: 'Sample WS · Sales', domainCanonicalId: 'dom:analytics' },
  { canonicalId: 'ws:finance', name: 'Sample WS · Finance', domainCanonicalId: 'dom:analytics' },
  { canonicalId: 'ws:marketing', name: 'Sample WS · Marketing', domainCanonicalId: 'dom:analytics' },
  { canonicalId: 'ws:iot', name: 'Sample WS · IoT', domainCanonicalId: 'dom:platform' },
  { canonicalId: 'ws:sap', name: 'Sample WS · SAP', domainCanonicalId: 'dom:platform' },
  { canonicalId: 'ws:platform', name: 'Sample WS · Platform', domainCanonicalId: 'dom:platform' },
  { canonicalId: 'ws:shared', name: 'Sample WS · Shared', domainCanonicalId: 'dom:platform' },
  { canonicalId: 'ws:hr', name: 'Sample WS · People', domainCanonicalId: 'dom:analytics' },
  { canonicalId: 'ws:ops', name: 'Sample WS · Operations', domainCanonicalId: 'dom:platform' },
] satisfies WorkspaceRef[];

const view = new URLSearchParams(location.search).get('view');
const root = createRoot(document.getElementById('root')!);

if (view === 'lineage') {
  /* --------------------------------------------------------- lineage preview */
  const items: CatalogItem[] = [];
  const edges: LineageEdge[] = [];
  let ei = 0;
  const item = (cid: string, name: string, itemType: string, ws: string, gov = false): CatalogItem => {
    const it: CatalogItem = { id: cid, canonicalId: cid, source: 'Fabric', name, itemType, workspaceCanonicalId: ws };
    if (gov) { it.owner = 'ada@contoso.com'; it.description = 'Curated dataset.'; it.endorsement = 'Certified'; it.sensitivityLabel = 'Sample Confidential'; }
    items.push(it); return it;
  };
  const edge = (a: CatalogItem, b: CatalogItem, rel: string) => { edges.push({ canonicalId: `edge:${ei++}`, fromCanonicalId: a.canonicalId, toCanonicalId: b.canonicalId, relationship: rel, fromName: a.name, toName: b.name, fromType: a.itemType, toType: b.itemType }); };
  const lakes: CatalogItem[] = [];
  WS.slice(0, 7).forEach((w, i) => {
    const short = w.name.split(' ')[0];
    const lh = item(`${w.canonicalId}:lh`, `${short}_lakehouse`, 'Lakehouse', w.canonicalId, i % 2 === 0); lakes.push(lh);
    const ep = item(`${w.canonicalId}:ep`, `${short}_lakehouse`, 'SQLEndpoint', w.canonicalId); edge(lh, ep, 'Provides');
    const nb = item(`${w.canonicalId}:nb`, `nb_transform_${short}`, 'Notebook', w.canonicalId); edge(nb, lh, 'DataSource');
    const pl = item(`${w.canonicalId}:pl`, `pl_load_${short}`, 'DataPipeline', w.canonicalId); edge(pl, nb, 'Orchestrates');
    if (i < 5) {
      const wh = item(`${w.canonicalId}:wh`, `${short}_warehouse`, 'Warehouse', w.canonicalId, i % 3 === 0); edge(ep, wh, 'DependsOn');
      const sm = item(`${w.canonicalId}:sm`, `${short}_model`, 'SemanticModel', w.canonicalId, true); edge(wh, sm, 'DependsOn');
      const rp = item(`${w.canonicalId}:rp`, `${short} Executive Report`, 'Report', w.canonicalId); edge(sm, rp, 'DependsOn');
      if (i < 3) { const rp2 = item(`${w.canonicalId}:rp2`, `${short} Ops Dashboard`, 'Report', w.canonicalId); edge(sm, rp2, 'DependsOn'); }
    }
  });
  edge(lakes[6], lakes[0], 'Shortcut'); edge(lakes[6], lakes[1], 'Shortcut'); edge(lakes[6], lakes[2], 'Shortcut');
  edge(lakes[4], lakes[5], 'Shortcut'); edge(lakes[3], lakes[5], 'Shortcut');
  const ext = item('external:crm', 'Salesforce CRM', 'External', 'external'); edge(ext, lakes[0], 'DataSource');
  const cj = item('ws:platform:cj', 'CopyJob_SAP_to_Sales', 'CopyJob', 'ws:platform'); edge(lakes[5], cj, 'Reads'); edge(cj, lakes[0], 'Writes');
  root.render(<FluentProvider theme={webLightTheme} style={{ height: '100vh' }}><LineageGraph items={items} edges={edges} workspaces={WS} /></FluentProvider>);
} else {
  /* --------------------------------------------------------- landing preview */
  const TYPES = ['Lakehouse', 'Warehouse', 'SQLEndpoint', 'Notebook', 'DataPipeline', 'SemanticModel', 'Report', 'Dataflow', 'KQLDatabase', 'Eventhouse', 'Dashboard', 'Datamart'];
  const OWNERS = ['ada@contoso.com', 'liu@contoso.com', 'sven@contoso.com', 'maria@contoso.com', 'omar@contoso.com'];
  const LABELS = ['Sample Restricted', 'Sample Confidential', 'Sample Internal', 'Sample Public'];
  const ENDORSE = ['Certified', 'Promoted'];
  let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

  const items: CatalogItem[] = [];
  let n = 0;
  for (const w of WS) {
    const count = 8 + Math.floor(rnd() * 16);
    for (let k = 0; k < count; k++) {
      const t = pick(TYPES);
      const it: CatalogItem = {
        id: `it:${n}`, canonicalId: `it:${n}`, source: 'Fabric', name: `${w.name.split(' ')[0]}_${t.toLowerCase()}_${k + 1}`,
        itemType: t, workspaceCanonicalId: w.canonicalId, domainCanonicalId: w.domainCanonicalId,
        firstSeen: new Date(Date.now() - Math.floor(rnd() * 60) * 86400000).toISOString(),
      };
      if (rnd() < 0.46) it.owner = pick(OWNERS);
      if (rnd() < 0.34) it.description = 'Business-curated dataset used across reporting.';
      if (rnd() < 0.24) it.sensitivityLabel = pick(LABELS);
      if (rnd() < 0.20) it.endorsement = pick(ENDORSE);
      items.push(it); n++;
    }
  }
  const noop = () => {};
  const log = (m: string) => () => console.log('[preview]', m);
  root.render(
    <FluentProvider theme={webLightTheme} style={{ height: '100vh', overflow: 'auto', background: '#faf9f8' }}>
      <CommandCenterHome
        items={items} workspaces={WS} domains={DOMAINS}
        favorites={[items[3].id, items[20].id]} recents={[items[5].id, items[12].id, items[40].id]}
        onSelect={(id) => console.log('[preview] select', id)}
        onBrowseType={(t) => console.log('[preview] browseType', t)}
        onBrowseAll={log('browseAll')} onGap={(g) => console.log('[preview] gap', g)}
        onHas={(v) => console.log('[preview] has', v)} onWorkspaces={log('workspaces')}
        onWorkspaceSelect={(id) => console.log('[preview] ws', id)} onOpenObservability={noop}
      />
    </FluentProvider>,
  );
}
