import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import type { UiSettingsResponse, UiSettingsUpdateRequest } from '../../shared/api/v1/ui-settings.js';
import { toHttpError } from './errors.js';
import { DEFAULT_MAX_RACKS_PER_ROW, getRuntimeConfig, writeUserConfigOverride } from '../config/runtime-config.js';

const uiSettingsQuerySchema = z.strictObject({});

// Mirrors UiSettingsUpdateRequest; see that type for why this is a subset
// of the full config rather than the whole PATCH-able surface.
const uiSettingsUpdateBodySchema = z
  .object({
    topology: z
      .object({
        maxRacksPerRow: z.number().int().min(1).max(20).optional(),
        rackOrder: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).max(200).optional(),
      })
      .strict()
      .optional(),
    charts: z
      .object({
        cpu: z.object({ showSecondaryLayer: z.boolean().optional() }).strict().optional(),
        memory: z.object({ showSecondaryLayer: z.boolean().optional() }).strict().optional(),
        gpu: z.object({ showSecondaryLayer: z.boolean().optional() }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function toUiSettingsResponse(): UiSettingsResponse {
  const config = getRuntimeConfig();
  return {
    charts: {
      cpu: { showSecondaryLayer: config.ui.charts.cpu.showSecondaryLayer },
      memory: { showSecondaryLayer: config.ui.charts.memory.showSecondaryLayer },
      gpu: { showSecondaryLayer: config.ui.charts.gpu.showSecondaryLayer },
    },
    navbar: {
      enabled: config.ui.navbar.enabled,
      title: config.ui.navbar.title,
      color: config.ui.navbar.color,
    },
    topology: {
      maxRacksPerRow: config.topology?.maxRacksPerRow ?? DEFAULT_MAX_RACKS_PER_ROW,
      rackOrder: config.topology?.rackOrder ?? [],
    },
  };
}

// Translates the wire-level request body (which mirrors the RESPONSE shape,
// e.g. top-level `charts`) into the server's config-tree shape (`ui.charts`)
// expected by runtime-config.ts's userWritableConfigSchema.
function toConfigUpdate(body: UiSettingsUpdateRequest): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (body.topology) {
    update.topology = body.topology;
  }
  if (body.charts) {
    update.ui = { charts: body.charts };
  }
  return update;
}

function createUiSettingsHandler() {
  return asyncHandler(async (req, res) => {
    const parsed = uiSettingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(ProblemCode.BadRequest, `Invalid query parameters: ${detail}`);
    }
    try {
      res.json(toUiSettingsResponse());
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

function createUiSettingsUpdateHandler() {
  return asyncHandler(async (req, res) => {
    const parsed = uiSettingsUpdateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(ProblemCode.BadRequest, `Invalid request body: ${detail}`);
    }
    if (Object.keys(parsed.data).length === 0) {
      throw new HttpError(ProblemCode.BadRequest, 'Request body must set at least one setting.');
    }
    try {
      writeUserConfigOverride(toConfigUpdate(parsed.data));
      res.json(toUiSettingsResponse());
    } catch (error) {
      if (error instanceof z.ZodError) {
        const detail = error.issues
          .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
          .join('; ');
        throw new HttpError(ProblemCode.BadRequest, `Invalid configuration: ${detail}`);
      }
      throw toHttpError(error);
    }
  });
}

export {
  createUiSettingsHandler,
  createUiSettingsUpdateHandler,
  toUiSettingsResponse,
  uiSettingsQuerySchema,
  uiSettingsUpdateBodySchema,
};
