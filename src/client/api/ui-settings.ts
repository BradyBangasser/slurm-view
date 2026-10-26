import type { UiSettingsResponse, UiSettingsUpdateRequest } from '../../shared/api/v1/ui-settings.ts';
import { apiUrl } from './base.ts';
import { fetchJson, patchJson } from './client.ts';

function fetchUiSettings(options: { signal?: AbortSignal } = {}): Promise<UiSettingsResponse> {
  return fetchJson<UiSettingsResponse>(apiUrl('ui-settings'), options);
}

function updateUiSettings(
  update: UiSettingsUpdateRequest,
  options: { signal?: AbortSignal } = {}
): Promise<UiSettingsResponse> {
  return patchJson<UiSettingsResponse>(apiUrl('ui-settings'), update, options);
}

export { fetchUiSettings, updateUiSettings };
