import { getRayfinClient, isLocalBackend, fetchAll } from './rayfinClient';
import { cachedQuery } from './queryCache';

export interface AssetRoleAssignment {
  canonicalId: string;
  principalDisplayName?: string;
  principalType: string;
  role: string;
  scope: 'item' | 'workspace';
}

const ROLE_FIELDS = [
  'canonicalId',
  'principalDisplayName',
  'principalType',
  'role',
] as const;

type RoleRow = Omit<AssetRoleAssignment, 'scope'>;

async function getScopeAssignments(scopeCanonicalId: string): Promise<RoleRow[]> {
  const client = getRayfinClient();
  const rows = await fetchAll(client.data.RoleAssignment
    .select([...ROLE_FIELDS])
    .where({ scopeCanonicalId: { eq: scopeCanonicalId } }));
  return rows as RoleRow[];
}

/**
 * Read only the access grants relevant to one asset. Workspace grants are
 * included because they apply to every item in that workspace; tenant-wide
 * principal data is never downloaded for the profile.
 */
export async function getAssetRoleAssignments(
  itemCanonicalId: string,
  workspaceCanonicalId?: string,
): Promise<AssetRoleAssignment[]> {
  if (isLocalBackend()) return [];
  return cachedQuery(`access:${itemCanonicalId}:${workspaceCanonicalId ?? ''}`, async () => {
    const [direct, inherited] = await Promise.all([
      getScopeAssignments(itemCanonicalId),
      workspaceCanonicalId ? getScopeAssignments(workspaceCanonicalId) : Promise.resolve([]),
    ]);
    return [
      ...direct.map((row) => ({ ...row, scope: 'item' as const })),
      ...inherited.map((row) => ({ ...row, scope: 'workspace' as const })),
    ].sort((left, right) => {
      if (left.scope !== right.scope) return left.scope === 'item' ? -1 : 1;
      return (left.principalDisplayName ?? '').localeCompare(right.principalDisplayName ?? '');
    });
  });
}