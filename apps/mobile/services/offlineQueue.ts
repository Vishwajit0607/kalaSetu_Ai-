import { Q } from '@nozbe/watermelondb';
import * as Network from 'expo-network';
import { getDb, isOfflineDbAvailable } from '@/db';
import type { SyncQueueModel } from '@/db';
import { ApiError, api } from './apiClient';

/**
 * Durable outbox for work that can safely be replayed later.
 *
 * Jobs live in SQLite, so they survive a force-quit and a dead battery. It
 * needs a development build: Expo Go has no WatermelonDB native module, and
 * there `enqueue` does nothing (see db/index.ts).
 *
 * Scope, stated plainly. This holds only operations that are *complete in
 * themselves* and idempotent to replay:
 *
 *   - marketplace_export : re-sends a list of product ids to ONDC / GeM / B2B
 *   - stock_delta        : applies a signed change to a product's stock
 *
 * It deliberately does NOT hold the new-product pipeline (photo, voice,
 * listing). Earlier versions queued `studio_edit`, `catalog_generate` and
 * `product_commit` jobs for that, but each needed a local product row to hang
 * its result on, and nothing ever created one - so the jobs ran, discarded
 * their output, and the artisan was told their work was "saved on the phone".
 * It was not. Offline product capture is a real feature (local draft rows, a
 * media upload queue, conflict handling) rather than a few job handlers, so the
 * pipeline now fails honestly when offline and lets the artisan retry.
 */

export type QueueKind = 'stock_delta' | 'marketplace_export';

const KIND_PRIORITY: Record<QueueKind, number> = {
  stock_delta: 0,
  marketplace_export: 1,
};

const MAX_ATTEMPTS = 8;

/** Exponential backoff capped at 30 minutes - enough to survive a long outage. */
function backoffMs(attempts: number): number {
  return Math.min(30 * 60 * 1000, 5000 * 2 ** attempts);
}

export async function enqueue(params: {
  kind: QueueKind;
  payload: Record<string, unknown>;
  localProductId?: string;
}): Promise<void> {
  // Expo Go has no local database - the capture still works, it just is not
  // replayable later. See db/index.ts.
  if (!isOfflineDbAvailable) return;

  await getDb().database.write(async () => {
    await getDb().collections.syncQueue.create((job) => {
      job.kind = params.kind;
      job.payload = params.payload;
      job.localProductId = params.localProductId ?? null;
      job.attempts = 0;
      job.lastError = null;
      job.nextAttemptAt = Date.now();
    });
  });
}

export async function pendingCount(): Promise<number> {
  if (!isOfflineDbAvailable) return 0;
  return getDb().collections.syncQueue.query().fetchCount();
}

export async function isOnline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

let draining = false;

export interface DrainResult {
  processed: number;
  failed: number;
  remaining: number;
  skippedOffline: boolean;
}

/**
 * Drain the outbox once. Safe to call from app foreground, a network-state
 * listener, or an expo-task-manager background fetch; the `draining` guard
 * keeps concurrent callers from double-submitting a job.
 */
export async function drainQueue(): Promise<DrainResult> {
  if (!isOfflineDbAvailable) {
    return { processed: 0, failed: 0, remaining: 0, skippedOffline: false };
  }

  if (draining) {
    return { processed: 0, failed: 0, remaining: await pendingCount(), skippedOffline: false };
  }

  if (!(await isOnline())) {
    return { processed: 0, failed: 0, remaining: await pendingCount(), skippedOffline: true };
  }

  draining = true;
  let processed = 0;
  let failed = 0;

  try {
    const due = await getDb().collections.syncQueue
      .query(Q.where('next_attempt_at', Q.lte(Date.now())))
      .fetch();

    const ordered = [...due].sort((a, b) => {
      const priority =
        (KIND_PRIORITY[a.kind as QueueKind] ?? 99) - (KIND_PRIORITY[b.kind as QueueKind] ?? 99);
      return priority !== 0 ? priority : a.createdAt.getTime() - b.createdAt.getTime();
    });

    for (const job of ordered) {
      try {
        await runJob(job);
        await getDb().database.write(async () => {
          await job.destroyPermanently();
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        const offline = error instanceof ApiError && error.code === 'offline';

        await getDb().database.write(async () => {
          await job.update((record) => {
            // An offline failure is not the job's fault - do not spend an attempt.
            record.attempts = offline ? record.attempts : record.attempts + 1;
            record.lastError = message;
            record.nextAttemptAt = Date.now() + backoffMs(record.attempts);
          });
        });

        if (!offline && job.attempts + 1 >= MAX_ATTEMPTS) {
          await getDb().database.write(async () => {
            await job.destroyPermanently();
          });
        }

        // Stop draining on a connectivity failure; the link is gone.
        if (offline) break;
      }
    }
  } finally {
    draining = false;
  }

  return { processed, failed, remaining: await pendingCount(), skippedOffline: false };
}

async function runJob(job: SyncQueueModel): Promise<void> {
  switch (job.kind as QueueKind) {
    case 'stock_delta':
      return runStockDelta(job);
    case 'marketplace_export':
      return runMarketplaceExport(job);
    default:
      // A job kind from an older app version. Dropping it is right: it can
      // never succeed, and leaving it would retry forever.
      throw new Error(`Unknown queue kind: ${job.kind}`);
  }
}

async function runStockDelta(job: SyncQueueModel): Promise<void> {
  const payload = job.payload as { serverProductId: string; delta: number };

  await api.adjustStock(payload.serverProductId, { delta: payload.delta });

  // Mark the matching local ledger rows settled.
  const movements = await getDb().collections.stockMovements
    .query(Q.where('product_id', job.localProductId ?? ''), Q.where('synced', false))
    .fetch();

  await getDb().database.write(async () => {
    await getDb().database.batch(
      ...movements.map((movement) =>
        movement.prepareUpdate((record) => {
          record.synced = true;
        }),
      ),
    );
  });
}

async function runMarketplaceExport(job: SyncQueueModel): Promise<void> {
  const payload = job.payload as {
    productIds: string[];
    channels: Array<'ondc' | 'gem' | 'b2b'>;
  };

  await api.exportToMarketplaces({ product_ids: payload.productIds, channels: payload.channels });
}

/** Clear a permanently-stuck job after the artisan taps "skip". */
export async function discardJob(jobId: string): Promise<void> {
  if (!isOfflineDbAvailable) return;
  const job = await getDb().collections.syncQueue.find(jobId);
  await getDb().database.write(async () => {
    await job.destroyPermanently();
  });
}
