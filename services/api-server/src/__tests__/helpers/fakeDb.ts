/**
 * A tiny stand-in for the Supabase client, for the account tests.
 *
 * Every chained call (`.from().select().eq()...`) is recorded and returns the same
 * builder. Awaiting the builder - or `.single()` / `.maybeSingle()` - pops the next
 * queued result, so a test scripts the database's answers in the order the code
 * asks for them. `auth.admin.*` calls are recorded and answered the same way.
 *
 * Use from a test with:
 *
 *   vi.mock('../services/supabase.service.js', async (importOriginal) => {
 *     const original = await importOriginal<typeof import('../services/supabase.service.js')>();
 *     const { fakeSupabase } = await import('./helpers/fakeDb.js');
 *     return { ...original, supabase: fakeSupabase };
 *   });
 */

export interface FakeResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

export type FakeCall = [method: string, args: unknown[]];

export const db = {
  calls: [] as FakeCall[],
  queue: [] as FakeResult[],
  admin: {
    signOut: { error: null } as { error: { message: string } | null },
    updateUserById: { data: { user: { id: 'u' } }, error: null } as { data: unknown; error: { message: string } | null },
  },

  reset(): void {
    this.calls = [];
    this.queue = [];
    this.admin.signOut = { error: null };
    this.admin.updateUserById = { data: { user: { id: 'u' } }, error: null };
  },

  /** Script the next table-query answers, in order. */
  answer(...results: Array<Partial<FakeResult>>): void {
    for (const result of results) this.queue.push({ data: null, error: null, ...result });
  },

  next(): FakeResult {
    return this.queue.shift() ?? { data: null, error: null };
  },

  argsOf(method: string): unknown[] | undefined {
    return this.calls.find(([name]) => name === method)?.[1];
  },

  allOf(method: string): unknown[][] {
    return this.calls.filter(([name]) => name === method).map(([, args]) => args);
  },
};

function makeBuilder(): unknown {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(db.next()).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          db.calls.push([String(prop), args]);
          return builder;
        };
      },
    },
  );
  return builder;
}

export function fakeSupabase() {
  return {
    rpc: async (name: string, args: unknown) => {
      db.calls.push(['rpc', [name, args]]);
      return db.next();
    },
    from: (table: string) => {
      db.calls.push(['from', [table]]);
      return makeBuilder();
    },
    auth: {
      admin: {
        signOut: async (...args: unknown[]) => {
          db.calls.push(['admin.signOut', args]);
          return db.admin.signOut;
        },
        updateUserById: async (...args: unknown[]) => {
          db.calls.push(['admin.updateUserById', args]);
          return db.admin.updateUserById;
        },
      },
    },
  };
}
