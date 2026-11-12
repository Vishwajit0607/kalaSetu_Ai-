import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError } from './apiClient';
import {
  MAX_EXTRA_PHOTOS,
  useCatalogDraftStore,
  type ExtraPhoto,
} from '@/store/useCatalogDraftStore';

/**
 * Extra angles for one product.
 *
 * Each extra goes through the *same* studio pipeline as the cover - same
 * backdrop, relight and shadow - so a product's photos look like one shoot.
 * That is also why changing the studio settings re-styles them (see
 * `restyleExtraPhotos`): a gallery where one shot is on white and the next on
 * wood reads as a mistake on a marketplace listing.
 *
 * Everything here reads the draft through `getState()` at the moment it needs
 * it. The studio runs these from async callbacks, and a render-time snapshot
 * would be stale by the time an upload finishes.
 */

/** Longest edge sent to the server; see the note on MAX_UPLOAD_EDGE in studio.tsx. */
export const MAX_UPLOAD_EDGE = 1600;

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

export interface ExtraPhotoOutcome {
  added: number;
  /** Photos dropped because the studio could not process them. */
  failed: number;
  /** Photos not taken because the product already has the maximum. */
  skipped: number;
  /** A sentence to speak/show when something failed, in the artisan's language. */
  message: string | null;
}

/** One at a time: the server's background removal is CPU-bound, and the draft is shared. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

let counter = 0;
const newId = () => `extra-${Date.now().toString(36)}-${(counter += 1)}`;

async function downscale(photo: PickedPhoto): Promise<string> {
  if (Math.max(photo.width, photo.height) <= MAX_UPLOAD_EDGE) return photo.uri;
  const small = await ImageManipulator.manipulateAsync(
    photo.uri,
    [{ resize: photo.width >= photo.height ? { width: MAX_UPLOAD_EDGE } : { height: MAX_UPLOAD_EDGE } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  return small.uri;
}

const studioStyle = () => {
  const { backdrop, relight, shadow } = useCatalogDraftStore.getState();
  return { backdrop, relight, shadow };
};

/** Best-effort server cleanup; a failure only leaves an unused file behind. */
function discardHosted(urls: Array<string | null | undefined>): void {
  const real = urls.filter((url): url is string => Boolean(url));
  if (real.length > 0) void api.removeMedia(real).catch(() => undefined);
}

async function processNew(id: string, photo: PickedPhoto): Promise<string | null> {
  const store = useCatalogDraftStore.getState();
  try {
    const uri = await downscale(photo);
    if (uri !== photo.uri) {
      void FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => undefined);
    }

    const result = await api.editPhoto({ fileUri: uri, ...studioStyle() });

    if (result.degraded) {
      // Neither studio engine could process it. A gallery of unprocessed
      // snapshots beside a studio cover looks worse than fewer photos, so drop
      // it and say so rather than keeping a half-result.
      discardHosted([result.raw_image_url]);
      store.dropExtraPhoto(id);
      return null; // caller reports a generic "couldn't process"
    }

    store.patchExtraPhoto(id, {
      rawUrl: result.raw_image_url,
      enhancedUrl: result.enhanced_image_url,
      busy: false,
    });
    return 'ok';
  } catch (caught) {
    store.dropExtraPhoto(id);
    return caught instanceof ApiError ? caught.spokenHi : '';
  }
}

/**
 * Add photos to the product. Shows each one at once (from the local file) and
 * fills in the studio result as the server finishes them.
 */
export async function addExtraPhotos(
  photos: PickedPhoto[],
  failedMessage: string,
): Promise<ExtraPhotoOutcome> {
  const store = useCatalogDraftStore.getState();
  const room = Math.max(0, MAX_EXTRA_PHOTOS - store.extraPhotos.length);
  const taken = photos.slice(0, room);
  const skipped = photos.length - taken.length;

  const entries: Array<{ entry: ExtraPhoto; photo: PickedPhoto }> = taken.map((photo) => ({
    photo,
    entry: { id: newId(), previewUri: photo.uri, rawUrl: null, enhancedUrl: null, busy: true },
  }));
  store.addExtraPhotos(entries.map((item) => item.entry));

  let added = 0;
  let message: string | null = null;
  await Promise.all(
    entries.map(({ entry, photo }) =>
      enqueue(async () => {
        const outcome = await processNew(entry.id, photo);
        if (outcome === 'ok') added += 1;
        else message ??= outcome || failedMessage;
      }),
    ),
  );

  return { added, failed: taken.length - added, skipped, message };
}

/** Remove an extra from the draft and discard its hosted files. */
export function removeExtraPhoto(id: string): void {
  const store = useCatalogDraftStore.getState();
  const photo = store.extraPhotos.find((item) => item.id === id);
  if (!photo || photo.busy) return;
  store.dropExtraPhoto(id);
  discardHosted([photo.rawUrl, photo.enhancedUrl]);
}

/** Starting the product over: discard every extra already uploaded. */
export function discardAllExtraPhotos(): void {
  const { extraPhotos } = useCatalogDraftStore.getState();
  discardHosted(extraPhotos.flatMap((photo) => [photo.rawUrl, photo.enhancedUrl]));
}

/**
 * Re-run every finished extra with the current studio settings. A photo whose
 * re-style fails keeps its previous look rather than disappearing.
 */
export async function restyleExtraPhotos(): Promise<{ failed: number }> {
  const store = useCatalogDraftStore.getState();
  const targets = store.extraPhotos.filter((photo) => photo.rawUrl && !photo.busy);
  if (targets.length === 0) return { failed: 0 };

  targets.forEach((photo) => store.patchExtraPhoto(photo.id, { busy: true }));

  let failed = 0;
  await Promise.all(
    targets.map((target) =>
      enqueue(async () => {
        const live = useCatalogDraftStore.getState();
        try {
          const result = await api.editPhoto({
            rawImageUrl: target.rawUrl as string,
            ...(target.enhancedUrl ? { previousEnhancedUrl: target.enhancedUrl } : {}),
            ...studioStyle(),
          });
          if (result.degraded) {
            failed += 1;
            live.patchExtraPhoto(target.id, { busy: false });
            return;
          }
          live.patchExtraPhoto(target.id, { enhancedUrl: result.enhanced_image_url, busy: false });
        } catch {
          failed += 1;
          live.patchExtraPhoto(target.id, { busy: false });
        }
      }),
    ),
  );
  return { failed };
}

/** URLs to save with the product: finished extras only, in display order. */
export function extraPhotoUrls(photos: ExtraPhoto[]): string[] {
  return photos.flatMap((photo) => (photo.enhancedUrl && !photo.busy ? [photo.enhancedUrl] : []));
}
