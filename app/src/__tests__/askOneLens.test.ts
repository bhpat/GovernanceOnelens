import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.stubEnv('VITE_FABRIC_TENANT_ID', 'tenant-id');
  vi.stubEnv('VITE_RAYFIN_FABRIC_SPA_CLIENT_ID', 'client-id');
  vi.stubEnv('VITE_FABRIC_WORKSPACE_ID', 'workspace-id');
  vi.stubEnv('VITE_RAYFIN_ASKONELENS_WORKSPACE_ID', 'analysis-workspace-id');
  vi.stubEnv('VITE_RAYFIN_ASKONELENS_AGENT_ID', 'agent-id');
});

it('builds the MCP endpoint from the analysis workspace and agent ids', async () => {
  const { dataAgentMcpUrl } = await import('@/services/askOneLens');
  expect(dataAgentMcpUrl('analysis-workspace-id', 'agent-id')).toBe(
    'https://api.fabric.microsoft.com/v1/mcp/workspaces/analysis-workspace-id/dataagents/agent-id/agent',
  );
});

describe('parseMcpSsePayload', () => {
  it('joins multiple data lines in one event', async () => {
    const { parseMcpSsePayload } = await import('@/services/askOneLens');
    const result = parseMcpSsePayload(
      'event: message\ndata: {"id":7,\ndata: "result":{"tools":[]}}\n\n',
      7,
    );

    expect(result).toEqual({ id: 7, result: { tools: [] } });
  });

  it('selects the matching RPC response after notifications', async () => {
    const { parseMcpSsePayload } = await import('@/services/askOneLens');
    const result = parseMcpSsePayload(
      'data: {"result":{"tools":[{"name":"notification"}]}}\n\n'
        + 'data: {"id":11,"result":{"tools":[{"name":"ask"}]}}\n\n'
        + 'data: [DONE]\n\n',
      11,
    );

    expect(result.result?.tools?.[0]?.name).toBe('ask');
  });

  it('rejects malformed event data', async () => {
    const { parseMcpSsePayload } = await import('@/services/askOneLens');
    expect(() => parseMcpSsePayload('data: not-json\n\n', 1)).toThrow(
      'Ask OneLens returned an invalid event-stream response.',
    );
  });
});