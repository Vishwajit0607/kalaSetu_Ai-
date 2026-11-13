/**
 * Recording must never leave the app muted or the microphone open.
 */

let mockPrepareShouldFail = false;
const mockRecordings: Array<{ stopAndUnloadAsync: jest.Mock; startAsync: jest.Mock }> = [];

jest.mock('expo-av', () => {
  class MockRecording {
    stopAndUnloadAsync = jest.fn(async () => undefined);
    startAsync = jest.fn(async () => undefined);
    prepareToRecordAsync = jest.fn(async () => {
      if (mockPrepareShouldFail) throw new Error('microphone unavailable');
    });
    setOnRecordingStatusUpdate = jest.fn();
    setProgressUpdateInterval = jest.fn();
    getURI = jest.fn(() => 'file:///rec.m4a');
    getStatusAsync = jest.fn(async () => ({ durationMillis: 1500 }));
    constructor() {
      mockRecordings.push(this);
    }
  }
  return {
    Audio: {
      Recording: MockRecording,
      Sound: {
        createAsync: jest.fn(async () => ({
          sound: {
            playAsync: jest.fn(async () => undefined),
            stopAsync: jest.fn(async () => undefined),
            unloadAsync: jest.fn(async () => undefined),
            setOnPlaybackStatusUpdate: jest.fn(),
          },
        })),
      },
      setAudioModeAsync: jest.fn(async () => undefined),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      AndroidOutputFormat: { MPEG_4: 1 },
      AndroidAudioEncoder: { AAC: 1 },
      IOSOutputFormat: { MPEG4AAC: 1 },
      IOSAudioQuality: { MEDIUM: 1 },
    },
  };
});

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1000 })),
  deleteAsync: jest.fn(async () => undefined),
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));
jest.mock('../services/apiClient', () => ({ ApiError: class extends Error {}, api: { speak: jest.fn() } }));

import { startRecording } from '../services/audioRecorder';
import { isRecordingActive, setRecordingActive, speak } from '../services/speech';

beforeEach(() => {
  mockPrepareShouldFail = false;
  mockRecordings.length = 0;
  setRecordingActive(false);
});

describe('a failed recording start', () => {
  it('does not leave speech muted forever', async () => {
    // startRecording flags "recording" first so speech cannot bleed into the
    // take. If the mic then fails to open, nothing reset that flag - every
    // spoken prompt in the app stayed silent until the app was restarted.
    mockPrepareShouldFail = true;

    await expect(startRecording()).rejects.toThrow('microphone unavailable');

    expect(isRecordingActive()).toBe(false);
    expect(await speak('can you hear me', 'en-IN')).toBe(true);
  });
});

describe('a successful recording', () => {
  it('blocks speech while recording and releases it on stop', async () => {
    const handle = await startRecording();
    expect(isRecordingActive()).toBe(true);
    expect(await speak('nope', 'en-IN')).toBe(false);

    await handle.stop();
    expect(isRecordingActive()).toBe(false);
  });

  it('releases speech on cancel too', async () => {
    const handle = await startRecording();
    await handle.cancel();
    expect(isRecordingActive()).toBe(false);
  });
});
