import type { DataExport } from './apiClient';

/**
 * Small pure helpers around the "download my data" file, so what the artisan ends
 * up holding - its name, its text, and whether it is complete - is tested.
 */

/** kalasetu-export-2026-11-13.json, from the server's own timestamp. */
export function exportFilename(exportedAt: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(exportedAt)?.[0] ?? 'data';
  return `kalasetu-export-${day}.json`;
}

/** Human-readable (indented) JSON: the person may open it in a text editor. */
export function serializeExport(data: DataExport): string {
  return JSON.stringify(data, null, 2);
}

/** True if the server had to cut a long list short, so the file is not the whole story. */
export function wasTruncated(data: Pick<DataExport, 'truncated'>): boolean {
  return Array.isArray(data.truncated) && data.truncated.length > 0;
}
