import { Router } from 'express';
import type { NodesCache } from '../../cache/nodes-cache.js';
import { createTopologyHandler } from '../../handlers/topology.js';

function createTopologyRouter(nodesCache: NodesCache | undefined): Router {
  const router = Router();
  router.get('/', createTopologyHandler(nodesCache));
  return router;
}

export { createTopologyRouter };
