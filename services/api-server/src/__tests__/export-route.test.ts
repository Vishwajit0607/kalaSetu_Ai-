import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';
import { OTHER, ME, call, setupAuth, teardownAuth } from './helpers/authedApp.js';
import { EXPORT_ROW_CAP } from '../services/export.service.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => db.reset());

const profile = { id: ME, phone_number: '+919876543210', full_name: 'Asha', craft_category: 'Pottery' };

/** The export asks in this order: profile, products, stock, inquiries received, inquiries sent, security events. */
const script = (over: Partial<Record<'products' | 'stock' | 'received' | 'sent' | 'events', unknown[]>> = {}) =>
  db.answer(
    { data: profile },
    { data: over.products ?? [{ id: 'p1', title_en: 'Pot' }] },
    { data: over.stock ?? [{ id: 'm1', delta: -2 }] },
    { data: over.received ?? [{ id: 'i1', buyer_name: 'Ravi' }] },
    { data: over.sent ?? [] },
    { data: over.events ?? [{ id: 'e1', event_type: 'login', ip: '203.0.113.9', user_agent: 'ua', created_at: '2026-11-13T10:00:00Z' }] },
  );

describe('GET /v1/me/export', () => {
  it('returns the artisan\'s data as a downloadable JSON file', async () => {
    script();
    const res = await call('GET', '/v1/me/export');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="kalasetu-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = res.json();
    expect(body.artisan).toMatchObject({ id: ME, full_name: 'Asha' });
    expect(body.products).toEqual([{ id: 'p1', title_en: 'Pot' }]);
    expect(body.stock_movements).toEqual([{ id: 'm1', delta: -2 }]);
    expect(body.inquiries_received).toHaveLength(1);
    expect(body.counts).toEqual({ products: 1, stock_movements: 1, inquiries_received: 1, inquiries_sent: 0, security_events: 1 });
    expect(body.truncated).toEqual([]);
  });

  it('masks addresses in the security events, as the activity screen does', async () => {
    script();
    const res = await call('GET', '/v1/me/export');
    expect(res.json().security_events[0].ip).toBe('203.0.113.x');
  });

  it('reads only the token\'s artisan from every table', async () => {
    script();
    await call('GET', `/v1/me/export?artisan_id=${OTHER}`, { as: ME });

    const owners = (db.allOf('eq') as Array<[string, string]>).filter(([column]) => column === 'artisan_id' || column === 'buyer_artisan_id');
    expect(owners.length).toBeGreaterThanOrEqual(5);
    expect(owners.every(([, value]) => value === ME)).toBe(true);
    expect(db.allOf('from').map((a) => a[0])).toEqual(['artisans', 'products', 'stock_movements', 'buyer_inquiries', 'buyer_inquiries', 'auth_events']);
  });

  it('says so when a list was cut at the cap, instead of passing off a partial copy as whole', async () => {
    const many = Array.from({ length: EXPORT_ROW_CAP + 1 }, (_, i) => ({ id: `p${i}` }));
    script({ products: many });
    const body = (await call('GET', '/v1/me/export')).json();

    expect(body.products).toHaveLength(EXPORT_ROW_CAP);
    expect(body.truncated).toEqual(['products']);
  });

  it('exports an empty list for a table whose migration has not been applied yet', async () => {
    db.answer(
      { data: profile },
      { data: [] },
      { error: { code: '42P01', message: 'relation "stock_movements" does not exist' } },
      { data: [] },
      { error: { code: '42703', message: 'column buyer_inquiries.buyer_artisan_id does not exist' } },
      { error: { code: 'PGRST205', message: 'Could not find the table public.auth_events' } },
    );
    const res = await call('GET', '/v1/me/export');
    expect(res.statusCode).toBe(200);
    expect(res.json().stock_movements).toEqual([]);
    expect(res.json().inquiries_sent).toEqual([]);
    expect(res.json().security_events).toEqual([]);
  });

  it('does not hide a real database failure', async () => {
    db.answer({ data: profile }, { error: { code: '08006', message: 'connection failure' } });
    expect((await call('GET', '/v1/me/export')).statusCode).toBe(500);
  });

  it('is a 404 if the account no longer exists, and requires a token', async () => {
    db.answer({ data: null });
    expect((await call('GET', '/v1/me/export')).statusCode).toBe(404);

    db.reset();
    expect((await call('GET', '/v1/me/export', { as: null })).statusCode).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});
