// Resolved presentation policy for the React UI. This is a small,
// read-only view of the server's runtime config: the frontend learns
// *what to show* (e.g. whether a chart's secondary ring is enabled,
// navbar title/color) without knowing about config.d files, YAML merging,
// or backend calculation settings such as CPU-load thresholds.
// Effectively immutable for the lifetime of the server process.
export interface ChartViewPolicy {
  showSecondaryLayer: boolean;
}

export interface NavbarViewPolicy {
  enabled: boolean;
  title: string;
  color: string;
}

// The subset of `topology` that is a per-user preference rather than site
// layout: row width and custom rack order, both written back through
// PATCH /api/v1/ui-settings into the viewer's own config.d override, never
// into the site's racks.yaml.
export interface TopologyViewPolicy {
  maxRacksPerRow: number;
  rackOrder: string[];
}

export interface UiSettingsResponse {
  charts: {
    cpu: ChartViewPolicy;
    memory: ChartViewPolicy;
    gpu: ChartViewPolicy;
  };
  navbar: NavbarViewPolicy;
  topology: TopologyViewPolicy;
}

// Body accepted by PATCH /api/v1/ui-settings. Every field is optional —
// only the keys present are changed — and this interface intentionally
// mirrors only the user-writable subset of the server's config schema
// (see runtime-config.ts's userWritableConfigSchema), not the full
// UiSettingsResponse shape: there is no way to PATCH navbar settings,
// since those stay admin-owned.
export interface UiSettingsUpdateRequest {
  topology?: {
    maxRacksPerRow?: number;
    rackOrder?: string[];
  };
  charts?: {
    cpu?: { showSecondaryLayer?: boolean };
    memory?: { showSecondaryLayer?: boolean };
    gpu?: { showSecondaryLayer?: boolean };
  };
}
