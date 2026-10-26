import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { expandSlurmHostlist } from '../adapters/slurm/hostlist.js';

const SYSTEM_CONFIG_DIR_PATH = path.resolve(__dirname, '..', '..', '..', 'config.d');
const USER_CONFIG_DIR_PATH = path.join(os.homedir(), '.local', 'slurm-view', 'config.d');
const hexColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a valid hex color like #123abc');

const cpuLoadThresholdsSchema = z.object({
    lowMax: z.number().gt(0).lt(1),
    mediumMax: z.number().gt(0).lt(1)
}).strict();

type CpuLoadThresholds = z.infer<typeof cpuLoadThresholdsSchema>;

const chartDisplaySchema = z.object({
    showSecondaryLayer: z.boolean()
}).strict();

const navbarSchema = z.object({
    enabled: z.boolean(),
    title: z.string().min(1),
    color: hexColorSchema
}).strict();

// Physical rack layout. Slurm has no notion of where a node lives, so the
// site describes it: pods hold racks, racks hold boxes listed by lowest
// rack unit. A box's `name` is a Slurm hostlist so a multi-node chassis
// is one line ("nova22-[1-4]").
const DEFAULT_RACK_HEIGHT = 42;
const DEFAULT_MAX_RACKS_PER_ROW = 6;

const topologyBoxSchema = z.object({
    name: z.string().trim().min(1),
    u: z.number().int().min(1),
    height: z.number().int().min(1).default(1),
    verify: z.string().optional()
}).strict();

const topologyRackSchema = z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'must be 1-32 letters, digits, "_" or "-"'),
    nodes: z.array(topologyBoxSchema).min(1)
}).strict();

const topologyPodSchema = z.object({
    name: z.string().trim().min(1),
    racks: z.array(topologyRackSchema)
}).strict();

const topologyPodsSchema = z.array(topologyPodSchema);

const topologyLoadSchema = z.object({
    gradientSteps: z.number().int().min(2).max(64).default(16)
}).strict();

// A rack id (per-user ordering preference); not validated against the
// site's actual `topology.pods` here, since this schema has no knowledge
// of them yet when a user config file is parsed in isolation.
const rackOrderSchema = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).max(200);

const topologySchema = z.object({
    rackHeight: z.number().int().min(1).max(64).default(DEFAULT_RACK_HEIGHT),
    maxRacksPerRow: z.number().int().min(1).max(20).default(DEFAULT_MAX_RACKS_PER_ROW),
    // Per-user display order for racks (drag-to-reorder), by rack id. Absent
    // or listing unknown ids just means "no preference yet" / "stale ids" —
    // the frontend falls back to layout order for anything not listed.
    rackOrder: rackOrderSchema.optional(),
    load: topologyLoadSchema.default({ gradientSteps: 16 }),
    pods: topologyPodsSchema
}).strict();

type TopologyConfig = z.infer<typeof topologySchema>;

// Cross-entry checks a per-field schema cannot express: boxes fit the
// rack, boxes in one rack do not overlap, and no rack or node is listed
// twice anywhere.
function validateTopology(topology: TopologyConfig, ctx: z.RefinementCtx): void {
    const rackIds = new Map<string, string>();
    const nodeOwners = new Map<string, string>();

    topology.pods.forEach((pod, podIndex) => {
        pod.racks.forEach((rack, rackIndex) => {
            const rackPath = ['topology', 'pods', podIndex, 'racks', rackIndex];
            const previousPod = rackIds.get(rack.id);
            if (previousPod !== undefined) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [...rackPath, 'id'],
                    message: `rack ${rack.id} is listed twice (also in pod ${previousPod})`
                });
            }
            rackIds.set(rack.id, pod.name);

            const unitOwners = new Map<number, string>();
            rack.nodes.forEach((box, boxIndex) => {
                const boxPath = [...rackPath, 'nodes', boxIndex];
                const top = box.u + box.height - 1;
                if (top > topology.rackHeight) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [...boxPath, 'u'],
                        message: `${box.name} in rack ${rack.id} occupies U${box.u}-U${top}, above rackHeight ${topology.rackHeight}`
                    });
                }
                for (let unit = box.u; unit <= Math.min(top, topology.rackHeight); unit += 1) {
                    const owner = unitOwners.get(unit);
                    if (owner !== undefined) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: [...boxPath, 'u'],
                            message: `${box.name} overlaps ${owner} at U${unit} in rack ${rack.id}`
                        });
                        break;
                    }
                    unitOwners.set(unit, box.name);
                }

                for (const nodeName of expandSlurmHostlist(box.name)) {
                    const owner = nodeOwners.get(nodeName);
                    if (owner !== undefined) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: [...boxPath, 'name'],
                            message: `node ${nodeName} is placed twice (rack ${owner} and rack ${rack.id})`
                        });
                    }
                    nodeOwners.set(nodeName, rack.id);
                }
            });
        });
    });
}

const featuresSchema = z.object({
    snapshotHistory: z.boolean().default(false)
}).strict();

const runtimeConfigSchema = z.object({
    stats: z.object({
        cpuLoad: z.object({
            thresholds: cpuLoadThresholdsSchema
        }).strict()
    }).strict(),
    ui: z.object({
        charts: z.object({
            cpu: chartDisplaySchema,
            memory: chartDisplaySchema,
            gpu: chartDisplaySchema
        }).strict(),
        navbar: navbarSchema
    }).strict(),
    topology: topologySchema.optional(),
    features: featuresSchema.default({ snapshotHistory: false })
}).strict().superRefine((value, ctx) => {
    if (value.stats.cpuLoad.thresholds.lowMax >= value.stats.cpuLoad.thresholds.mediumMax) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stats', 'cpuLoad', 'thresholds', 'lowMax'],
            message: 'stats.cpuLoad.thresholds.lowMax must be smaller than stats.cpuLoad.thresholds.mediumMax'
        });
    }
    if (value.topology) {
        validateTopology(value.topology, ctx);
    }
});

type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

const runtimeConfigPartialSchema = z.object({
    stats: z.object({
        cpuLoad: z.object({
            thresholds: z.object({
                lowMax: z.number().gt(0).lt(1).optional(),
                mediumMax: z.number().gt(0).lt(1).optional()
            }).strict().optional()
        }).strict().optional()
    }).strict().optional(),
    ui: z.object({
        charts: z.object({
            cpu: z.object({
                showSecondaryLayer: z.boolean().optional()
            }).strict().optional(),
            memory: z.object({
                showSecondaryLayer: z.boolean().optional()
            }).strict().optional(),
            gpu: z.object({
                showSecondaryLayer: z.boolean().optional()
            }).strict().optional()
        }).strict().optional(),
        navbar: z.object({
            enabled: z.boolean().optional(),
            title: z.string().min(1).optional(),
            color: hexColorSchema.optional()
        }).strict().optional()
    }).strict().optional(),
    // `pods` is a list, so the merge takes it whole from the first file
    // that sets it; racks are not combined across files.
    topology: z.object({
        rackHeight: z.number().int().min(1).max(64).optional(),
        maxRacksPerRow: z.number().int().min(1).max(20).optional(),
        rackOrder: rackOrderSchema.optional(),
        load: z.object({
            gradientSteps: z.number().int().min(2).max(64).optional()
        }).strict().optional(),
        pods: topologyPodsSchema.optional()
    }).strict().optional(),
    features: z.object({
        snapshotHistory: z.boolean().optional()
    }).strict().optional()
}).strict();

// Deliberately narrow: what a logged-in viewer may write back to their own
// `~/.local/slurm-view/config.d` override, via PATCH /api/v1/ui-settings.
// This is a SUBSET of runtimeConfigPartialSchema, not an alias of it — keys
// like `topology.pods` (the site's physical layout) are never listed here,
// so a user-initiated write can't reach them even though they're otherwise
// valid partial-schema keys. Extend this schema, not the route handler,
// when a new setting becomes user-writable.
const userWritableChartSchema = z.object({
    showSecondaryLayer: z.boolean().optional()
}).strict();

const userWritableConfigSchema = z.object({
    topology: z.object({
        maxRacksPerRow: z.number().int().min(1).max(20).optional(),
        rackOrder: rackOrderSchema.optional()
    }).strict().optional(),
    ui: z.object({
        charts: z.object({
            cpu: userWritableChartSchema.optional(),
            memory: userWritableChartSchema.optional(),
            gpu: userWritableChartSchema.optional()
        }).strict().optional()
    }).strict().optional()
}).strict();

type UserWritableConfig = z.infer<typeof userWritableConfigSchema>;

const USER_OVERRIDE_FILE_NAME = 'ui-overrides.yaml';

function getUserOverrideFilePath(userConfigDir: string = USER_CONFIG_DIR_PATH): string {
    return path.join(userConfigDir, USER_OVERRIDE_FILE_NAME);
}

function readYamlObjectFile(filePath: string): Record<string, unknown> {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    const parsed: unknown = YAML.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }

    return parsed as Record<string, unknown>;
}

function deepMergeOverride(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = { ...base };

    Object.keys(override).forEach((key) => {
        const baseValue = output[key];
        const overrideValue = override[key];

        if (
            baseValue &&
            overrideValue &&
            typeof baseValue === 'object' &&
            typeof overrideValue === 'object' &&
            !Array.isArray(baseValue) &&
            !Array.isArray(overrideValue)
        ) {
            output[key] = deepMergeOverride(
                baseValue as Record<string, unknown>,
                overrideValue as Record<string, unknown>
            );
            return;
        }

        output[key] = overrideValue;
    });

    return output;
}

// Validates `update` against the user-writable subset, merges it into the
// viewer's own ui-overrides.yaml (creating it on first use), and reloads +
// re-validates the full merged config (site + every user file) so a bad
// write is caught the same way a bad admin edit would be. On failure the
// previous file content is restored and the in-memory config stays valid.
function writeUserConfigOverride(update: unknown, options: LoadOptions = undefined): RuntimeConfig {
    const validatedUpdate = userWritableConfigSchema.parse(update) as UserWritableConfig;
    const { userConfigDir } = normalizeLoadOptions(options);
    const resolvedUserConfigDir = userConfigDir ?? USER_CONFIG_DIR_PATH;

    fs.mkdirSync(resolvedUserConfigDir, { recursive: true });
    const filePath = getUserOverrideFilePath(resolvedUserConfigDir);

    const existing = readYamlObjectFile(filePath);
    const merged = deepMergeOverride(existing, validatedUpdate as Record<string, unknown>);
    const backupContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;

    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, YAML.stringify(merged), 'utf8');
    fs.renameSync(tmpPath, filePath);

    try {
        return loadRuntimeConfig(options);
    } catch (error) {
        if (backupContent === null) {
            fs.rmSync(filePath, { force: true });
        } else {
            fs.writeFileSync(filePath, backupContent, 'utf8');
        }
        loadRuntimeConfig(options);
        throw error;
    }
}

let loadedConfig: RuntimeConfig | null = null;

function normalizeComparableValue(value: unknown): unknown {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number(value.toFixed(12));
    }

    return value;
}

function valuesAreEqual(left: unknown, right: unknown): boolean {
    if (typeof left === 'number' && typeof right === 'number') {
        return Math.abs(left - right) < 1e-12;
    }

    return JSON.stringify(left) === JSON.stringify(right);
}

function flattenLeafValues(value: unknown, prefix = '', target: Record<string, unknown> = {}): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        if (!prefix) {
            return target;
        }

        target[prefix] = normalizeComparableValue(value);
        return target;
    }

    Object.keys(value as Record<string, unknown>).sort().forEach((key) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        flattenLeafValues((value as Record<string, unknown>)[key], nextPrefix, target);
    });

    return target;
}

function mergeObjectsWithFirstValue(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = { ...base };

    Object.keys(override).forEach((key) => {
        const baseValue = output[key];
        const overrideValue = override[key];

        if (
            baseValue &&
            overrideValue &&
            typeof baseValue === 'object' &&
            typeof overrideValue === 'object' &&
            !Array.isArray(baseValue) &&
            !Array.isArray(overrideValue)
        ) {
            output[key] = mergeObjectsWithFirstValue(
                baseValue as Record<string, unknown>,
                overrideValue as Record<string, unknown>
            );
            return;
        }

        if (Object.prototype.hasOwnProperty.call(output, key)) {
            return;
        }

        output[key] = overrideValue;
    });

    return output;
}

function formatZodError(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const issuePath = issue.path.length ? issue.path.join('.') : 'root';
            return `${issuePath}: ${issue.message}`;
        })
        .join('; ');
}

interface LoadOptionsObject {
    systemConfigDir?: string | null | undefined;
    userConfigDir?: string | null | undefined;
}

type LoadOptions = string | LoadOptionsObject | undefined;

interface NormalizedLoadOptions {
    systemConfigDir: string | null | undefined;
    userConfigDir: string | null | undefined;
}

function normalizeLoadOptions(options: LoadOptions = undefined): NormalizedLoadOptions {
    if (typeof options === 'string') {
        return {
            systemConfigDir: options,
            userConfigDir: null
        };
    }

    return {
        systemConfigDir: options && Object.prototype.hasOwnProperty.call(options, 'systemConfigDir')
            ? (options as LoadOptionsObject).systemConfigDir
            : SYSTEM_CONFIG_DIR_PATH,
        userConfigDir: options && Object.prototype.hasOwnProperty.call(options, 'userConfigDir')
            ? (options as LoadOptionsObject).userConfigDir
            : USER_CONFIG_DIR_PATH
    };
}

interface ConfigFileRef {
    fileName: string;
    filePath: string;
}

function getConfigFilesForDirectory(configDir: string | null | undefined, isOptional: boolean): ConfigFileRef[] {
    if (!configDir || !fs.existsSync(configDir)) {
        if (isOptional) {
            return [];
        }

        throw new Error(`Configuration directory not found: ${configDir}`);
    }

    return fs.readdirSync(configDir)
        .filter((fileName) => fileName.endsWith('.yaml') || fileName.endsWith('.yml'))
        .sort((left, right) => left.localeCompare(right))
        .map((fileName) => ({
            fileName,
            filePath: path.join(configDir, fileName)
        }));
}

function loadRuntimeConfig(options: LoadOptions = undefined): RuntimeConfig {
    const { systemConfigDir, userConfigDir } = normalizeLoadOptions(options);
    const configFiles = [
        ...getConfigFilesForDirectory(userConfigDir, true),
        ...getConfigFilesForDirectory(systemConfigDir, false)
    ];

    if (configFiles.length === 0) {
        throw new Error(`No YAML configuration files found in: ${systemConfigDir}`);
    }

    const seenValuesByPath = new Map<string, { value: unknown; filePath: string }>();
    let mergedConfig: Record<string, unknown> = {};

    configFiles.forEach(({ fileName, filePath }) => {
        const fileContent = fs.readFileSync(filePath, 'utf8');

        let parsedConfig: unknown;
        try {
            parsedConfig = YAML.parse(fileContent);
        } catch (error) {
            throw new Error(`Invalid YAML in ${fileName}: ${(error as Error).message}`);
        }

        const normalizedConfig = parsedConfig === null ? {} : parsedConfig;

        if (typeof normalizedConfig !== 'object' || Array.isArray(normalizedConfig)) {
            throw new Error(`Invalid root structure in ${fileName}: expected a YAML mapping/object`);
        }

        const partialValidation = runtimeConfigPartialSchema.safeParse(normalizedConfig);
        if (!partialValidation.success) {
            throw new Error(`Configuration validation failed for ${fileName}: ${formatZodError(partialValidation.error)}`);
        }

        const leafValues = flattenLeafValues(partialValidation.data);
        Object.entries(leafValues).forEach(([keyPath, value]) => {
            if (!seenValuesByPath.has(keyPath)) {
                seenValuesByPath.set(keyPath, { value, filePath });
                return;
            }

            const previous = seenValuesByPath.get(keyPath)!;
            const isSameValue = valuesAreEqual(previous.value, value);
            const duplicateReason = isSameValue ? 'Duplicate key' : 'Conflicting duplicate key';
            console.warn(
                `[Config] WARN ${duplicateReason} '${keyPath}' in ${filePath}; using first occurrence from ${previous.filePath}`
            );
        });

        mergedConfig = mergeObjectsWithFirstValue(mergedConfig, partialValidation.data as Record<string, unknown>);
    });

    const finalValidation = runtimeConfigSchema.safeParse(mergedConfig);
    if (!finalValidation.success) {
        throw new Error(`Final configuration validation failed: ${formatZodError(finalValidation.error)}`);
    }

    loadedConfig = finalValidation.data;
    return loadedConfig;
}

function initializeRuntimeConfig(options: LoadOptions = undefined): RuntimeConfig {
    return loadRuntimeConfig(options);
}

function getRuntimeConfig(): RuntimeConfig {
    if (!loadedConfig) {
        return loadRuntimeConfig();
    }

    return loadedConfig;
}

function resetRuntimeConfigForTests(): void {
    loadedConfig = null;
}

export {
    DEFAULT_RACK_HEIGHT,
    DEFAULT_MAX_RACKS_PER_ROW,
    SYSTEM_CONFIG_DIR_PATH,
    USER_CONFIG_DIR_PATH,
    USER_OVERRIDE_FILE_NAME,
    initializeRuntimeConfig,
    getRuntimeConfig,
    loadRuntimeConfig,
    writeUserConfigOverride,
    getUserOverrideFilePath,
    resetRuntimeConfigForTests,
    runtimeConfigSchema,
    runtimeConfigPartialSchema,
    userWritableConfigSchema
};
export type { RuntimeConfig, CpuLoadThresholds, TopologyConfig, UserWritableConfig };
