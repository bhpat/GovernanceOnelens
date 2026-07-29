import { Domain } from './Domain.js';
import { Workspace } from './Workspace.js';
import { Item } from './Item.js';
import { RoleAssignment } from './RoleAssignment.js';
import { CoverageMetric } from './CoverageMetric.js';
import { PostureSnapshot } from './PostureSnapshot.js';
import { LineageEdge } from './LineageEdge.js';
import { MetricSnapshot } from './MetricSnapshot.js';
import { Connector } from './Connector.js';
import { ScanRun } from './ScanRun.js';

/**
 * Governance OneLens canonical schema. Every entity is `source`-tagged so new
 * connectors are additive (no schema change). Scanners upsert via the locked
 * direct-SQL MERGE path; the app reads via the generated GraphQL API.
 */
export type AppSchema = {
  Domain: Domain;
  Workspace: Workspace;
  Item: Item;
  RoleAssignment: RoleAssignment;
  CoverageMetric: CoverageMetric;
  PostureSnapshot: PostureSnapshot;
  LineageEdge: LineageEdge;
  MetricSnapshot: MetricSnapshot;
  Connector: Connector;
  ScanRun: ScanRun;
};

export const schema = [Domain, Workspace, Item, RoleAssignment, CoverageMetric, PostureSnapshot, LineageEdge, MetricSnapshot, Connector, ScanRun];
