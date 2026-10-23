import type { TopologyResponse } from '../../shared/api/v1/topology.ts';
import { apiUrl } from './base.ts';
import { fetchJson } from './client.ts';

function fetchTopology(options: { signal?: AbortSignal } = {}): Promise<TopologyResponse> {
  return fetchJson<TopologyResponse>(apiUrl('topology'), options);
}

export { fetchTopology };
