import express, { Router } from 'express';
import { createUiSettingsHandler, createUiSettingsUpdateHandler } from '../../handlers/ui-settings.js';

function createUiSettingsRouter(): Router {
  const router = Router();
  router.get('/', createUiSettingsHandler());
  // Small, trusted body: a handful of scalar/array settings, never a file
  // upload or the layout YAML itself.
  router.patch('/', express.json({ limit: '16kb' }), createUiSettingsUpdateHandler());
  return router;
}

export { createUiSettingsRouter };
