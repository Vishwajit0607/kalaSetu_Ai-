import { NativeModules } from 'react-native';
import { Database, type Collection } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import {
  ArtisanModel,
  BuyerInquiryModel,
  ProductModel,
  StockMovementModel,
  SyncQueueModel,
} from './models';

/**
 * Local offline catalog.
 *
 * WatermelonDB needs its native module (`WMDatabaseBridge`) linked - every
 * adapter mode does, JSI or the older bridge dispatcher, there is no JS-only
 * fallback. Stock Expo Go does not ship it.
 *
 * So the database is built lazily and only when that native module is
 * actually present. In Expo Go the app still boots and every screen renders;
 * the offline outbox and background sync simply stay inert, and anything that
 * needs them degrades instead of taking the whole app down at import time.
 * A development build (`npx expo run:android` / `run:ios`) restores them.
 */
export const isOfflineDbAvailable = Boolean(NativeModules.WMDatabaseBridge);

export interface DbCollections {
  artisans: Collection<ArtisanModel>;
  products: Collection<ProductModel>;
  stockMovements: Collection<StockMovementModel>;
  inquiries: Collection<BuyerInquiryModel>;
  syncQueue: Collection<SyncQueueModel>;
}

function build(): { database: Database; collections: DbCollections } | null {
  if (!isOfflineDbAvailable) return null;

  const adapter = new SQLiteAdapter({
    schema,
    dbName: 'kalasetu',
    jsi: true,
    onSetUpError: (error) => {
      // Surfaced to the user as a one-time "reinstall needed" screen; silently
      // swallowing this would look like permanent data loss.
      console.error('[db] failed to open the local catalog', error);
    },
  });

  const database = new Database({
    adapter,
    modelClasses: [
      ArtisanModel,
      ProductModel,
      StockMovementModel,
      BuyerInquiryModel,
      SyncQueueModel,
    ],
  });

  return {
    database,
    collections: {
      artisans: database.get<ArtisanModel>('artisans'),
      products: database.get<ProductModel>('products'),
      stockMovements: database.get<StockMovementModel>('stock_movements'),
      inquiries: database.get<BuyerInquiryModel>('buyer_inquiries'),
      syncQueue: database.get<SyncQueueModel>('sync_queue'),
    },
  };
}

const instance = build();

export const database = instance?.database ?? null;
export const collections = instance?.collections ?? null;

/**
 * Accessor for code paths that genuinely need the local database. Callers
 * must check `isOfflineDbAvailable` first and degrade; this throws only if
 * that check was skipped.
 */
export function getDb(): { database: Database; collections: DbCollections } {
  if (!instance) {
    throw new Error(
      'Local offline catalog unavailable: WatermelonDB needs a development build, not Expo Go.',
    );
  }
  return instance;
}

export {
  ArtisanModel,
  ProductModel,
  StockMovementModel,
  BuyerInquiryModel,
  SyncQueueModel,
};
