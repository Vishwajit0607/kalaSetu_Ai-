import { MAX_EXTRA_PHOTOS, useCatalogDraftStore } from '../store/useCatalogDraftStore';

const mockEditPhoto = jest.fn();
const mockRemoveMedia = jest.fn();

jest.mock('../services/apiClient', () => {
  class ApiError extends Error {
    spokenHi: string;
    constructor(spokenHi: string) {
      super(spokenHi);
      this.spokenHi = spokenHi;
    }
  }
  return {
    ApiError,
    api: {
      editPhoto: (...args: unknown[]) => mockEditPhoto(...args),
      removeMedia: (...args: unknown[]) => mockRemoveMedia(...args),
    },
  };
});
jest.mock('expo-file-system', () => ({ deleteAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri: `${uri}.small.jpg` })),
  SaveFormat: { JPEG: 'jpeg' },
}));

import { ApiError } from '../services/apiClient';
import {
  addExtraPhotos,
  discardAllExtraPhotos,
  extraPhotoUrls,
  removeExtraPhoto,
  restyleExtraPhotos,
} from '../services/extraPhotos';

// The mocked ApiError takes just the spoken message; the real one takes four args.
const apiError = (spoken: string) =>
  new (ApiError as unknown as new (spoken: string) => Error)(spoken);

const store = () => useCatalogDraftStore.getState();
const photo = (n: number, size = 1200) => ({ uri: `file:///p${n}.jpg`, width: size, height: size });

const edited = (n: number, degraded = false) => ({
  raw_image_url: `https://cdn/raw${n}.jpg`,
  enhanced_image_url: `https://cdn/enh${n}.jpg`,
  degraded,
  engine: 'local',
  fallback_reason: null,
  width: 1600,
  height: 1600,
  applied: [],
});

beforeEach(() => {
  store().reset();
  mockEditPhoto.mockReset();
  mockRemoveMedia.mockReset().mockResolvedValue({ removed: 1, kept: 0 });
});

describe('addExtraPhotos', () => {
  it('shows each photo at once, then fills in the studio result', async () => {
    let finish!: (value: unknown) => void;
    mockEditPhoto.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));

    const pending = addExtraPhotos([photo(1)], 'failed');
    // Still uploading: visible from the local file, flagged busy.
    expect(store().extraPhotos).toHaveLength(1);
    expect(store().extraPhotos[0]).toMatchObject({ previewUri: 'file:///p1.jpg', busy: true, enhancedUrl: null });

    finish(edited(1));
    const outcome = await pending;

    expect(outcome).toMatchObject({ added: 1, failed: 0, skipped: 0, message: null });
    expect(store().extraPhotos[0]).toMatchObject({
      rawUrl: 'https://cdn/raw1.jpg',
      enhancedUrl: 'https://cdn/enh1.jpg',
      busy: false,
    });
  });

  it('uses the studio look the cover uses', async () => {
    store().setStudioOptions({ backdrop: 'handloom-wood', relight: false, shadow: true });
    mockEditPhoto.mockResolvedValue(edited(1));
    await addExtraPhotos([photo(1)], 'failed');
    expect(mockEditPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ backdrop: 'handloom-wood', relight: false, shadow: true }),
    );
  });

  it('shrinks big photos before uploading and uploads small ones as they are', async () => {
    mockEditPhoto.mockResolvedValue(edited(1));
    await addExtraPhotos([photo(1, 4000)], 'failed');
    expect(mockEditPhoto.mock.calls[0][0].fileUri).toBe('file:///p1.jpg.small.jpg');

    mockEditPhoto.mockClear();
    await addExtraPhotos([photo(2, 800)], 'failed');
    expect(mockEditPhoto.mock.calls[0][0].fileUri).toBe('file:///p2.jpg');
  });

  it('adds several at once, processing them one at a time', async () => {
    let active = 0;
    let peak = 0;
    mockEditPhoto.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return edited(peak + Math.random());
    });
    const outcome = await addExtraPhotos([photo(1), photo(2), photo(3)], 'failed');
    expect(outcome.added).toBe(3);
    expect(peak).toBe(1);
    expect(store().extraPhotos.every((p) => !p.busy && p.enhancedUrl)).toBe(true);
  });

  it('stops at the maximum and reports how many it left out', async () => {
    mockEditPhoto.mockImplementation(async () => edited(Math.random()));
    const many = Array.from({ length: MAX_EXTRA_PHOTOS + 2 }, (_, i) => photo(i));
    const outcome = await addExtraPhotos(many, 'failed');
    expect(store().extraPhotos).toHaveLength(MAX_EXTRA_PHOTOS);
    expect(outcome).toMatchObject({ added: MAX_EXTRA_PHOTOS, skipped: 2 });
  });

  it('drops a photo the server rejects and reports its message, keeping the others', async () => {
    mockEditPhoto
      .mockResolvedValueOnce(edited(1))
      .mockRejectedValueOnce(apiError('Photo too large'))
      .mockResolvedValueOnce(edited(3));
    const outcome = await addExtraPhotos([photo(1), photo(2), photo(3)], 'failed');
    expect(outcome).toMatchObject({ added: 2, failed: 1, message: 'Photo too large' });
    expect(store().extraPhotos).toHaveLength(2);
  });

  it('does not keep a photo the studio could not process, and discards its upload', async () => {
    mockEditPhoto.mockResolvedValue(edited(1, true));
    const outcome = await addExtraPhotos([photo(1)], 'Could not process');
    expect(outcome).toMatchObject({ added: 0, failed: 1, message: 'Could not process' });
    expect(store().extraPhotos).toHaveLength(0);
    expect(mockRemoveMedia).toHaveBeenCalledWith(['https://cdn/raw1.jpg']);
  });
});

describe('removeExtraPhoto', () => {
  async function withOne() {
    mockEditPhoto.mockResolvedValue(edited(1));
    await addExtraPhotos([photo(1)], 'failed');
    return store().extraPhotos[0]!;
  }

  it('removes it from the draft and discards both hosted files', async () => {
    const added = await withOne();
    removeExtraPhoto(added.id);
    expect(store().extraPhotos).toHaveLength(0);
    expect(mockRemoveMedia).toHaveBeenCalledWith(['https://cdn/raw1.jpg', 'https://cdn/enh1.jpg']);
  });

  it('refuses while the photo is still uploading', async () => {
    const added = await withOne();
    store().patchExtraPhoto(added.id, { busy: true });
    removeExtraPhoto(added.id);
    expect(store().extraPhotos).toHaveLength(1);
    expect(mockRemoveMedia).not.toHaveBeenCalled();
  });

  it('discardAllExtraPhotos clears every hosted file when the product is started over', async () => {
    mockEditPhoto.mockResolvedValueOnce(edited(1)).mockResolvedValueOnce(edited(2));
    await addExtraPhotos([photo(1), photo(2)], 'failed');
    discardAllExtraPhotos();
    expect(mockRemoveMedia).toHaveBeenCalledWith([
      'https://cdn/raw1.jpg',
      'https://cdn/enh1.jpg',
      'https://cdn/raw2.jpg',
      'https://cdn/enh2.jpg',
    ]);
  });
});

describe('restyleExtraPhotos', () => {
  it('re-runs every finished extra with the new look, reusing the stored upload', async () => {
    mockEditPhoto.mockResolvedValueOnce(edited(1)).mockResolvedValueOnce(edited(2));
    await addExtraPhotos([photo(1), photo(2)], 'failed');

    store().setStudioOptions({ backdrop: 'dark-editorial' });
    mockEditPhoto.mockReset();
    mockEditPhoto.mockImplementation(async (params: { rawImageUrl: string }) => ({
      ...edited(0),
      enhanced_image_url: `${params.rawImageUrl}.dark.jpg`,
    }));

    const { failed } = await restyleExtraPhotos();
    expect(failed).toBe(0);
    expect(mockEditPhoto).toHaveBeenCalledTimes(2);
    expect(mockEditPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        rawImageUrl: 'https://cdn/raw1.jpg',
        previousEnhancedUrl: 'https://cdn/enh1.jpg',
        backdrop: 'dark-editorial',
      }),
    );
    expect(store().extraPhotos.map((p) => p.enhancedUrl)).toEqual([
      'https://cdn/raw1.jpg.dark.jpg',
      'https://cdn/raw2.jpg.dark.jpg',
    ]);
    expect(store().extraPhotos.every((p) => !p.busy)).toBe(true);
  });

  it('keeps a photo’s old look if the re-style fails, instead of losing it', async () => {
    mockEditPhoto.mockResolvedValueOnce(edited(1));
    await addExtraPhotos([photo(1)], 'failed');

    mockEditPhoto.mockRejectedValueOnce(apiError('offline'));
    const { failed } = await restyleExtraPhotos();

    expect(failed).toBe(1);
    expect(store().extraPhotos[0]).toMatchObject({ enhancedUrl: 'https://cdn/enh1.jpg', busy: false });
  });

  it('does nothing when there are no extras', async () => {
    expect(await restyleExtraPhotos()).toEqual({ failed: 0 });
    expect(mockEditPhoto).not.toHaveBeenCalled();
  });
});

describe('draft integration', () => {
  it('is not committable while an extra is still uploading', async () => {
    const s = store();
    s.setCapture('file:///c.jpg');
    s.setUploaded({ rawUrl: 'https://cdn/raw.jpg', enhancedUrl: 'https://cdn/enh.jpg', degraded: false });
    s.setCatalog({ title_en: 'x', title_hi: 'y' } as never);
    s.setCosting({ materialCostInr: 100, laborHours: 2, dimensionsCm: { length: 10, width: 10, height: 10 } });
    s.setPricing({ recommended_retail_inr: 1, recommended_wholesale_inr: 1 } as never);
    expect(store().isCommittable()).toBe(true);

    store().addExtraPhotos([{ id: 'e', previewUri: 'file:///e.jpg', rawUrl: null, enhancedUrl: null, busy: true }]);
    expect(store().isCommittable()).toBe(false);

    store().patchExtraPhoto('e', { rawUrl: 'r', enhancedUrl: 'https://cdn/e.jpg', busy: false });
    expect(store().isCommittable()).toBe(true);
  });

  it('extraPhotoUrls lists finished extras only, in order', () => {
    expect(
      extraPhotoUrls([
        { id: '1', previewUri: 'a', rawUrl: 'r1', enhancedUrl: 'u1', busy: false },
        { id: '2', previewUri: 'b', rawUrl: null, enhancedUrl: null, busy: true },
        { id: '3', previewUri: 'c', rawUrl: 'r3', enhancedUrl: 'u3', busy: false },
      ]),
    ).toEqual(['u1', 'u3']);
  });

  it('a retake clears the extras with the rest of the draft', async () => {
    mockEditPhoto.mockResolvedValue(edited(1));
    await addExtraPhotos([photo(1)], 'failed');
    store().reset();
    expect(store().extraPhotos).toEqual([]);
  });
});
