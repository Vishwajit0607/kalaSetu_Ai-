import { exportFilename, serializeExport, wasTruncated } from '../services/dataExport';
import type { DataExport } from '../services/apiClient';

const sample = (over: Partial<DataExport> = {}): DataExport => ({
  exported_at: '2026-11-13T10:00:00.000Z',
  artisan: { id: 'a', phone_number: '+919876543210', full_name: 'आशा', preferred_language: 'hi-IN', craft_category: 'Pottery', cluster_location: null, gi_tag_certified: false },
  products: [],
  stock_movements: [],
  inquiries_received: [],
  inquiries_sent: [],
  security_events: [],
  truncated: [],
  counts: {},
  ...over,
});

describe('exportFilename', () => {
  it('is named after the day of the export', () => {
    expect(exportFilename('2026-11-13T10:00:00.000Z')).toBe('kalasetu-export-2026-11-13.json');
  });

  it('still gives a usable name if the timestamp is not what was expected', () => {
    expect(exportFilename('')).toBe('kalasetu-export-data.json');
    expect(exportFilename('garbage')).toBe('kalasetu-export-data.json');
  });
});

describe('serializeExport', () => {
  it('produces indented JSON that parses back to the same data, Hindi included', () => {
    const data = sample();
    const text = serializeExport(data);
    expect(text).toContain('\n  "artisan"');
    expect(JSON.parse(text)).toEqual(data);
    expect(text).toContain('आशा'); // not escaped into \u sequences
  });
});

describe('wasTruncated', () => {
  it('is false for a complete export', () => {
    expect(wasTruncated(sample())).toBe(false);
  });

  it('is true when any list was cut short', () => {
    expect(wasTruncated(sample({ truncated: ['products'] }))).toBe(true);
  });

  it('is false if an older server sends no such field', () => {
    expect(wasTruncated({} as DataExport)).toBe(false);
  });
});
