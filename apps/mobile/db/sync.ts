import { Q, type Database } from '@nozbe/watermelondb';
import * as Network from 'expo-network';
import { getDb, isOfflineDbAvailable } from './index';
import type { ProductModel } from './models';
import { api } from '@/services/apiClient';
import { drainQueue } from '@/services/offlineQueue';

/**
 * Background sync engine.
 *
 * Bidirectional delta sync against the API server:
 *
 *   push : drain the durable outbox (media -> AI -> commit -> stock -> export)
 *   pull : fetch server rows changed since `lastPulledAt` and reconcile
 *
 * Conflict policy is deliberately asymmetric, and the asymmetry is the whole
 * design. For catalog *copy* (titles, descriptions, prices) the server wins,
 * because that text is AI-generated server-side and the phone's copy is a
 * stale draft. For `stock_quantity` the *local* value wins, because the artisan
 * physically handed over the goods - no server row knows better than the person
 * who made the sale. Stock is reconciled by replaying unsynced deltas on top of
 * the server count rather than overwriting either side.
 */

const LAST_PULLED_KEY = 'kalasetu.lastPulledAt';

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  skippedOffline: boolean;
  lastPulledAt: number | null;
  error?: string;
}

let syncing = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function readLastPulledAt(): Promise<number | null> {
  const raw = await getDb().database.localStorage.get<number>(LAST_PULLED_KEY);
  return typeof raw === 'number' ? raw : null;
}

async function writeLastPulledAt(value: number): Promise<void> {
  await getDb().database.localStorage.set(LAST_PULLED_KEY, value);
}

export async function synchronize(artisanServerId: string): Promise<SyncReport> {
  // No local database (Expo Go) - nothing to push or reconcile. The screens
  // read live from the API instead. See db/index.ts.
  if (!isOfflineDbAvailable) {
    return { pushed: 0, pulled: 0, conflicts: 0, skippedOffline: false, lastPulledAt: null };
  }

  if (syncing) {
    return {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      skippedOffline: false,
      lastPulledAt: await readLastPulledAt(),
    };
  }

  const network = await Network.getNetworkStateAsync();
  if (!network.isConnected || network.isInternetReachable === false) {
    return {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      skippedOffline: true,
      lastPulledAt: await readLastPulledAt(),
    };
  }

  syncing = true;
  try {
    /* ---------------------------------------------------------- push phase */
    const drain = await drainQueue();

    /* ---------------------------------------------------------- pull phase */
    const serverState = await api.inventory();
    const localProducts = await getDb().collections.products
      .query(Q.where('artisan_id', artisanServerId))
      .fetch();

    const localByServerId = new Map<string, ProductModel>();
    for (const product of localProducts) {
      if (product.serverId) localByServerId.set(product.serverId, product);
    }

    let conflicts = 0;
    const operations: unknown[] = [];

    for (const row of serverState.products) {
      const local = localByServerId.get(row.id);

      if (!local) {
        // New row from another device (or a reinstall restoring the catalog).
        operations.push(
          getDb().collections.products.prepareCreate((record) => {
            record.serverId = row.id;
            record.artisanId = row.artisan_id;
            record.sku = row.sku;
            record.rawImageUri = row.raw_image_url;
            record.rawImageUrl = row.raw_image_url;
            record.enhancedImageUri = null;
            record.enhancedImageUrl = row.enhanced_image_url;
            record.voiceNoteUri = null;
            record.voiceNoteUrl = null;
            record.nativeTranscript = null;
            record.titleEn = row.title_en;
            record.titleHi = row.title_hi;
            record.descriptionEn = row.description_en;
            record.descriptionHi = row.description_hi;
            record.seoTags = row.seo_tags;
            record.hsnCode = row.hsn_code;
            record.materialCostInr = 0;
            record.laborHours = 0;
            record.dimensionsCm = row.dimensions_cm;
            record.recommendedRetailInr = row.recommended_retail_inr;
            record.recommendedWholesaleInr = row.recommended_wholesale_inr;
            record.minWholesaleQty = row.min_wholesale_qty;
            record.stockQuantity = row.stock_quantity;
            record.marketplaceSyncStatus = row.marketplace_sync_status;
            record.aiStatus = 'ready';
            record.pendingMedia = false;
          }),
        );
        continue;
      }

      // Replay any stock movements this device has not pushed yet, so a sale
      // made offline is not erased by the server's older count.
      const unsyncedDelta = await getDb().collections.stockMovements
        .query(Q.where('product_id', local.id), Q.where('synced', false))
        .fetch()
        .then((movements) => movements.reduce((sum, movement) => sum + movement.delta, 0));

      const reconciledStock = Math.max(0, row.stock_quantity + unsyncedDelta);
      if (unsyncedDelta !== 0) conflicts += 1;

      operations.push(
        local.prepareUpdate((record) => {
          // Server wins on AI-generated copy and pricing.
          record.titleEn = row.title_en;
          record.titleHi = row.title_hi;
          record.descriptionEn = row.description_en;
          record.descriptionHi = row.description_hi;
          record.seoTags = row.seo_tags;
          record.hsnCode = row.hsn_code;
          record.recommendedRetailInr = row.recommended_retail_inr;
          record.recommendedWholesaleInr = row.recommended_wholesale_inr;
          record.minWholesaleQty = row.min_wholesale_qty;
          record.marketplaceSyncStatus = row.marketplace_sync_status;
          record.enhancedImageUrl = row.enhanced_image_url;
          // Local wins on physical stock.
          record.stockQuantity = reconciledStock;
          record.aiStatus = 'ready';
        }),
      );
    }

    if (operations.length > 0) {
      await getDb().database.write(async () => {
        await getDb().database.batch(...(operations as Parameters<Database['batch']>));
      });
    }

    const pulledAt = Date.now();
    await writeLastPulledAt(pulledAt);

    return {
      pushed: drain.processed,
      pulled: serverState.products.length,
      conflicts,
      skippedOffline: drain.skippedOffline,
      lastPulledAt: pulledAt,
    };
  } catch (error) {
    return {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      skippedOffline: false,
      lastPulledAt: await readLastPulledAt(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    syncing = false;
  }
}

/**
 * Start periodic sync. 90s is a deliberate compromise: frequent enough that a
 * trade-fair sale shows up on the buyer's side within a couple of minutes,
 * sparse enough that it does not drain a battery the artisan cannot easily
 * recharge.
 */
export function startBackgroundSync(
  artisanServerId: string,
  onReport?: (report: SyncReport) => void,
  intervalMs = 90_000,
): () => void {
  // Nothing to sync without a local database (Expo Go) - do not spin a timer
  // that would wake the device every 90s to do nothing.
  if (!isOfflineDbAvailable) return () => undefined;

  stopBackgroundSync();

  const tick = async (): Promise<void> => {
    const report = await synchronize(artisanServerId);
    onReport?.(report);
  };

  void tick();
  timer = setInterval(() => void tick(), intervalMs);

  return stopBackgroundSync;
}

export function stopBackgroundSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Count of local rows still waiting on the network, for the sync chip. */
export async function pendingSyncCount(): Promise<number> {
  if (!isOfflineDbAvailable) return 0;

  const [queued, unsyncedMovements, pendingProducts] = await Promise.all([
    getDb().collections.syncQueue.query().fetchCount(),
    getDb().collections.stockMovements.query(Q.where('synced', false)).fetchCount(),
    getDb().collections.products
      .query(Q.or(Q.where('pending_media', true), Q.where('ai_status', 'pending_ai')))
      .fetchCount(),
  ]);

  return queued + unsyncedMovements + pendingProducts;
}
