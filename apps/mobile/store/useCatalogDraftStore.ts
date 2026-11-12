import { create } from 'zustand';
import type { CatalogGeneration, DimensionsCm, PricingBreakdown } from '@/services/apiClient';

/**
 * In-flight product draft.
 *
 * One product moves through four screens - studio, voice, pricing, commit -
 * and must survive the artisan backing out of any of them. Nothing here is
 * written to the server until the final commit, so an abandoned attempt leaves
 * no half-product in the inventory grid.
 *
 * Images are held as *hosted URLs* the server returned, never as bytes. The
 * draft used to carry the enhanced PNG as a base64 string (~1.6 MB) across
 * four screens and re-upload it for every AI call; and it committed the
 * phone's own `file://` paths as the product's photos. Both are gone: the phone
 * keeps only a small local preview (`rawImageUri`) to show something
 * instantly while the upload runs.
 *
 * Screens must read this store with *selectors* (`useCatalogDraftStore(s =>
 * s.field)`) and use `useCatalogDraftStore.getState()` inside callbacks.
 * Subscribing to the whole store gives a new object on every `set`, which made
 * the pricing screen recalculate in a loop and the studio re-run an edit with
 * the setting from before the tap.
 */

export type PipelineStage =
  | 'idle'
  | 'captured'
  | 'enhancing'
  | 'enhanced'
  | 'transcribing'
  | 'translating'
  | 'generating'
  | 'ready'
  | 'failed';

/** Extra angles after the cover photo. */
export const MAX_EXTRA_PHOTOS = 5;

export interface ExtraPhoto {
  id: string;
  /** Local file, shown instantly while the studio edit runs. */
  previewUri: string;
  /** Hosted capture, kept so the photo can be re-styled without re-uploading. */
  rawUrl: string | null;
  /** Hosted studio render; null until the first edit finishes. */
  enhancedUrl: string | null;
  /** True while this photo is being uploaded or re-styled. */
  busy: boolean;
}

export interface CatalogDraft {
  stage: PipelineStage;

  /* Studio */
  /** Small local file, shown instantly. Never sent as the product photo. */
  rawImageUri: string | null;
  /** Hosted copy of the capture (needed to re-edit without re-uploading). */
  rawImageUrl: string | null;
  /** Hosted studio render. Equals rawImageUrl when the edit degraded. */
  enhancedImageUrl: string | null;
  backdrop: string;
  relight: boolean;
  shadow: boolean;
  studioDegraded: boolean;
  /** Additional photos of the same product; the cover is `enhancedImageUrl`. */
  extraPhotos: ExtraPhoto[];

  /* Voice */
  voiceNoteUrl: string | null;
  voiceDurationMs: number;
  nativeTranscript: string | null;
  hindiText: string | null;
  englishText: string | null;

  /* Costing */
  materialCostInr: number;
  laborHours: number;
  dimensionsCm: DimensionsCm;
  stockQuantity: number;

  /* AI output */
  catalog: CatalogGeneration | null;
  pricing: PricingBreakdown | null;
  error: string | null;
}

interface CatalogDraftState extends CatalogDraft {
  setStage: (stage: PipelineStage) => void;
  /** A fresh capture: every hosted result belongs to the old photo, so drop it. */
  setCapture: (uri: string) => void;
  setUploaded: (params: { rawUrl: string; enhancedUrl: string; degraded: boolean }) => void;
  addExtraPhotos: (photos: ExtraPhoto[]) => void;
  patchExtraPhoto: (id: string, patch: Partial<Omit<ExtraPhoto, 'id'>>) => void;
  dropExtraPhoto: (id: string) => void;
  setStudioOptions: (options: { backdrop?: string; relight?: boolean; shadow?: boolean }) => void;
  setVoiceNote: (params: { url: string | null; durationMs: number }) => void;
  setTranscript: (transcript: string) => void;
  setTranslations: (params: { hindi: string; english: string }) => void;
  /** Re-recording: clear the previous attempt so stale results are not shown as current. */
  resetVoice: () => void;
  setCosting: (params: {
    materialCostInr?: number;
    laborHours?: number;
    dimensionsCm?: Partial<DimensionsCm>;
  }) => void;
  setStockQuantity: (quantity: number) => void;
  setCatalog: (catalog: CatalogGeneration) => void;
  setPricing: (pricing: PricingBreakdown | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;

  /** True once the draft has everything the server will accept. */
  isCommittable: () => boolean;
}

const INITIAL: CatalogDraft = {
  stage: 'idle',
  rawImageUri: null,
  rawImageUrl: null,
  enhancedImageUrl: null,
  backdrop: 'marketplace-white',
  relight: true,
  shadow: true,
  studioDegraded: false,
  extraPhotos: [],
  voiceNoteUrl: null,
  voiceDurationMs: 0,
  nativeTranscript: null,
  hindiText: null,
  englishText: null,
  materialCostInr: 0,
  laborHours: 0,
  dimensionsCm: { length: 0, width: 0, height: 0 },
  stockQuantity: 1,
  catalog: null,
  pricing: null,
  error: null,
};

export const useCatalogDraftStore = create<CatalogDraftState>((set, get) => ({
  ...INITIAL,

  setStage: (stage) => set({ stage }),

  setCapture: (uri) =>
    set({
      rawImageUri: uri,
      rawImageUrl: null,
      enhancedImageUrl: null,
      studioDegraded: false,
      stage: 'captured',
      error: null,
    }),

  setUploaded: ({ rawUrl, enhancedUrl, degraded }) =>
    set({
      rawImageUrl: rawUrl,
      enhancedImageUrl: enhancedUrl,
      studioDegraded: degraded,
      stage: 'enhanced',
      error: null,
    }),

  addExtraPhotos: (photos) =>
    set((state) => ({
      extraPhotos: [...state.extraPhotos, ...photos].slice(0, MAX_EXTRA_PHOTOS),
    })),

  patchExtraPhoto: (id, patch) =>
    set((state) => ({
      extraPhotos: state.extraPhotos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    })),

  dropExtraPhoto: (id) =>
    set((state) => ({ extraPhotos: state.extraPhotos.filter((photo) => photo.id !== id) })),

  setStudioOptions: (options) => set((state) => ({ ...state, ...options })),

  setVoiceNote: ({ url, durationMs }) =>
    set({ voiceNoteUrl: url, voiceDurationMs: durationMs, stage: 'transcribing' }),

  setTranscript: (transcript) => set({ nativeTranscript: transcript, stage: 'translating' }),

  setTranslations: ({ hindi, english }) =>
    set({ hindiText: hindi, englishText: english, stage: 'generating' }),

  resetVoice: () =>
    set({
      voiceNoteUrl: null,
      voiceDurationMs: 0,
      nativeTranscript: null,
      hindiText: null,
      englishText: null,
      catalog: null,
      pricing: null,
      error: null,
    }),

  setCosting: ({ materialCostInr, laborHours, dimensionsCm }) =>
    set((state) => ({
      materialCostInr: materialCostInr ?? state.materialCostInr,
      laborHours: laborHours ?? state.laborHours,
      dimensionsCm: { ...state.dimensionsCm, ...dimensionsCm },
    })),

  setStockQuantity: (quantity) => set({ stockQuantity: Math.max(0, Math.min(100_000, quantity)) }),

  setCatalog: (catalog) => set({ catalog, stage: 'ready' }),
  setPricing: (pricing) => set({ pricing }),
  setError: (error) => set({ error, stage: error ? 'failed' : get().stage }),

  reset: () => set({ ...INITIAL }),

  isCommittable: () => {
    const state = get();
    return Boolean(
      state.rawImageUrl &&
        state.enhancedImageUrl &&
        state.catalog &&
        state.pricing &&
        state.materialCostInr > 0 &&
        // The server rejects a zero length or width, so require them here
        // instead of letting the artisan reach the last button and fail.
        state.dimensionsCm.length > 0 &&
        state.dimensionsCm.width > 0 &&
        // An extra still uploading has no hosted URL yet; saving now would drop it.
        !state.extraPhotos.some((photo) => photo.busy),
    );
  },
}));
