import { Skeleton, SkeletonItem, tokens } from '@fluentui/react-components';

/**
 * Reusable loading-state placeholders. Replaces bare centered `<Spinner>`s
 * with content-shaped skeletons that hint at the layout about to appear —
 * lower perceived wait time and a more polished, "the data is coming"
 * feeling than a generic spinner, without needing per-page bespoke skeletons.
 */

/** A grid of card-shaped placeholders (KPI tiles, connector/workspace cards). */
export function CardGridSkeleton({ count = 4, height = 96 }: { count?: number; height?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '16px',
            height,
            border: `1px solid ${tokens.colorNeutralStroke2}`,
            borderRadius: tokens.borderRadiusLarge,
          }}
        >
          <SkeletonItem shape="rectangle" style={{ width: '55%', height: '12px' }} />
          <SkeletonItem shape="rectangle" style={{ width: '35%', height: '26px' }} />
          <SkeletonItem shape="rectangle" style={{ width: '70%', height: '10px' }} />
        </Skeleton>
      ))}
    </div>
  );
}

/** A stack of table-row-shaped placeholders (catalog/workspace list views). */
export function TableRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div style={{ padding: '4px 16px' }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          key={i}
          style={{
            display: 'flex',
            gap: '14px',
            alignItems: 'center',
            padding: '11px 0',
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
          }}
        >
          <SkeletonItem shape="square" size={20} />
          <SkeletonItem shape="rectangle" style={{ flex: 2, height: '14px' }} />
          <SkeletonItem shape="rectangle" style={{ flex: 1, height: '14px' }} />
          <SkeletonItem shape="rectangle" style={{ flex: 1, height: '14px' }} />
        </Skeleton>
      ))}
    </div>
  );
}

/** A single wide content-block placeholder (headers, hero/summary areas). */
export function BlockSkeleton({ height = 120 }: { height?: number }) {
  return (
    <Skeleton style={{ padding: '4px 0' }}>
      <SkeletonItem shape="rectangle" style={{ height, borderRadius: tokens.borderRadiusLarge }} />
    </Skeleton>
  );
}

/** Standard "page is loading" composition: a few KPI cards + a list below. */
export function PageLoadingSkeleton({ cards = 4, rows = 6 }: { cards?: number; rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <CardGridSkeleton count={cards} />
      <TableRowsSkeleton rows={rows} />
    </div>
  );
}
