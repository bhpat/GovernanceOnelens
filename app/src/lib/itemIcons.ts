/**
 * Fabric item-type → official Fabric glyph mapping.
 *
 * Uses the shipped Microsoft Fabric icon set (`app/icons/Fabric_Icons/*_item.svg`)
 * so the catalog shows the SAME icons users see in the Fabric portal — instant
 * familiarity. New/unknown types fall back to the generic placeholder glyph, so
 * future item types degrade gracefully rather than breaking.
 */


/**
 * Fabric item-type -> official Fabric glyph mapping.
 *
 * Keep these imports explicit. Wildcard eager globs inline every icon shipped in
 * the source pack, including hundreds the application can never request.
 */
import apps from '../../icons/Fabric_Icons/apps_20_item.svg?url';
import copyJob from '../../icons/Fabric_Icons/copy_job_20_item.svg?url';
import dashboard from '../../icons/Fabric_Icons/dashboard_20_item.svg?url';
import dataAgent from '../../icons/Fabric_Icons/data_agent_20_item.svg?url';
import dataFactoryItem from '../../icons/Fabric_Icons/data_factory_20_item.svg?url';
import dataWarehouse from '../../icons/Fabric_Icons/data_warehouse_20_item.svg?url';
import dataflowGen2 from '../../icons/Fabric_Icons/dataflow_gen2_20_item.svg?url';
import datamart from '../../icons/Fabric_Icons/datamart_20_item.svg?url';
import environment from '../../icons/Fabric_Icons/environment_20_item.svg?url';
import eventHouse from '../../icons/Fabric_Icons/event_house_20_item.svg?url';
import eventstream from '../../icons/Fabric_Icons/eventstream_20_item.svg?url';
import experiments from '../../icons/Fabric_Icons/experiments_20_item.svg?url';
import exploration from '../../icons/Fabric_Icons/exploration_20_item.svg?url';
import genericPlaceholder from '../../icons/Fabric_Icons/generic_placeholder_20_item.svg?url';
import graphModel from '../../icons/Fabric_Icons/graph_model_instance_20_item.svg?url';
import kqlDatabase from '../../icons/Fabric_Icons/kql_database_20_item.svg?url';
import kqlQueryset from '../../icons/Fabric_Icons/kql_queryset_20_item.svg?url';
import kqlScript from '../../icons/Fabric_Icons/kql_script_20_item.svg?url';
import lakehouse from '../../icons/Fabric_Icons/lakehouse_20_item.svg?url';
import metricSets from '../../icons/Fabric_Icons/metric_sets_20_item.svg?url';
import mirroredDatabase from '../../icons/Fabric_Icons/mirrored_generic_database_20_item.svg?url';
import model from '../../icons/Fabric_Icons/model_20_item.svg?url';
import notebook from '../../icons/Fabric_Icons/notebook_20_item.svg?url';
import operationsAgent from '../../icons/Fabric_Icons/operations_agent_20_item.svg?url';
import paginatedReport from '../../icons/Fabric_Icons/paginated_report_20_item.svg?url';
import pipeline from '../../icons/Fabric_Icons/pipeline_20_item.svg?url';
import rdlReport from '../../icons/Fabric_Icons/rdl_report_20_item.svg?url';
import realTimeDashboard from '../../icons/Fabric_Icons/real_time_dashboard_20_item.svg?url';
import report from '../../icons/Fabric_Icons/report_20_item.svg?url';
import schemaModel from '../../icons/Fabric_Icons/schema_model_20_item.svg?url';
import semanticModel from '../../icons/Fabric_Icons/semantic_model_20_item.svg?url';
import sparkJobDefinition from '../../icons/Fabric_Icons/spark_job_direction_20_item.svg?url';
import sqlDatabase from '../../icons/Fabric_Icons/sql_database_20_item.svg?url';
import variableLibrary from '../../icons/Fabric_Icons/variable_library_20_item.svg?url';
import workspace from '../../icons/Fabric_Icons/group_workspace_20_non-item.svg?url';
import databasesColor from '../../icons/Fabric_Icons/databases_20_color.svg?url';
import dataFactoryColor from '../../icons/Fabric_Icons/data_factory_20_color.svg?url';
import fabricColor from '../../icons/Fabric_Icons/fabric_20_color.svg?url';
import oneLakeColor from '../../icons/Fabric_Icons/one_lake_20_color.svg?url';
import powerBiColor from '../../icons/Fabric_Icons/power_bi_20_color.svg?url';
import purviewColor from '../../icons/Fabric_Icons/purview_20_color.svg?url';

const ITEM_ICONS: Record<string, string> = {
  Notebook: notebook,
  Lakehouse: lakehouse,
  Warehouse: dataWarehouse,
  SQLDatabase: sqlDatabase,
  SQLEndpoint: sqlDatabase,
  SparkJobDefinition: sparkJobDefinition,
  Environment: environment,
  MirroredDatabase: mirroredDatabase,
  MirroredWarehouse: mirroredDatabase,
  DataPipeline: pipeline,
  Dataflow: dataflowGen2,
  CopyJob: copyJob,
  MountedDataFactory: dataFactoryItem,
  Report: report,
  PaginatedReport: paginatedReport,
  RDLReport: rdlReport,
  SemanticModel: semanticModel,
  Dashboard: dashboard,
  Datamart: datamart,
  Scorecard: dashboard,
  MetricSet: metricSets,
  KQLDatabase: kqlDatabase,
  KQLQueryset: kqlQueryset,
  KQLDashboard: realTimeDashboard,
  KQLScript: kqlScript,
  Eventhouse: eventHouse,
  Eventstream: eventstream,
  Reflex: operationsAgent,
  MLModel: model,
  MLExperiment: experiments,
  DataAgent: dataAgent,
  GraphModel: graphModel,
  Ontology: schemaModel,
  OperationsAgent: operationsAgent,
  Exploration: exploration,
  App: apps,
  OrgApp: apps,
  OrgAppAudience: apps,
  VariableLibrary: variableLibrary,
};

/** Bundled URL of the official Fabric glyph for an item type (never throws). */
export function itemIconUrl(itemType?: string): string {
  return (itemType && ITEM_ICONS[itemType]) || genericPlaceholder;
}

/** Whether a specific (non-fallback) glyph exists for this type. */
export function hasItemIcon(itemType?: string): boolean {
  return Boolean(itemType && ITEM_ICONS[itemType]);
}

/** Bundled URL of the Fabric workspace glyph. */
export const workspaceIconUrl = workspace;

const SOURCE_ICONS: Record<string, string> = {
  fabric: fabricColor,
  purview: purviewColor,
  onelake: oneLakeColor,
  powerbi: powerBiColor,
  power_bi: powerBiColor,
  databricks: databasesColor,
  informatica: dataFactoryColor,
  snowflake: databasesColor,
};

/** Bundled URL of the product/brand color glyph for a connector source, or null. */
export function sourceIconUrl(source?: string): string | null {
  return (source && SOURCE_ICONS[source.toLowerCase()]) || null;
}
