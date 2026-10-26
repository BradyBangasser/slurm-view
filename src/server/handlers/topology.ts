import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import type { TopologyResponse } from '../../shared/api/v1/topology.js';
import type { NodesCache } from '../cache/nodes-cache.js';
import { TopologyService } from '../services/topology-service.js';
import type { TopologyResult } from '../services/topology-service.js';
import { toHttpError } from './errors.js';
import { getRuntimeConfig } from '../config/runtime-config.js';

const topologyQuerySchema = z.strictObject({});

function toTopologyResponse(result: TopologyResult): TopologyResponse {
  return {
    configured: result.configured,
    rackHeight: result.rackHeight,
    loadThresholds: result.loadThresholds,
    loadGradientSteps: result.loadGradientSteps,
    pods: result.pods,
    unplaced: result.unplaced,
    updatedAt: result.updatedAt.toISOString(),
  };
}

function createTopologyHandler(nodesCache: NodesCache | undefined) {
  return asyncHandler(async (req, res) => {
    if (!nodesCache) {
      throw new HttpError(
        ProblemCode.SlurmUnavailable,
        'Node snapshot is not initialized.'
      );
    }
    const parsed = topologyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(ProblemCode.BadRequest, `Invalid query parameters: ${detail}`);
    }
    try {
      const config = getRuntimeConfig();
      const service = new TopologyService(nodesCache, config.topology, config.stats.cpuLoad.thresholds);
      const result = await service.getTopology();
      res.json(toTopologyResponse(result));
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

export { createTopologyHandler, toTopologyResponse };
