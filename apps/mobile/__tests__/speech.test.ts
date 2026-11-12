/**
 * Audio overlap: two spoken lines at once, or speech over the microphone.
 * The mocks record every Sound that is actually *playing* at any moment.
 */

type MockSound = {
  /** True the instant the sound produced any audio, even if stopped right after. */
  everPlayed: boolean;
  playing: boolean;
  unloaded: boolean;
  playAsync: jest.Mock;
  stopAsync: jest.Mock;
  unloadAsync: jest.Mock;
  setOnPlaybackStatusUpdate: jest.Mock;
};

const mockSounds: MockSound[] = [];
const mockCreateDelays: number[] = [];

function mockMakeSound(shouldPlay: boolean): MockSound {
  const sound: MockSound = {
    everPlayed: shouldPlay,
    playing: shouldPlay,
    unloaded: false,
    playAsync: jest.fn(async () => {
      sound.playing = true;
      sound.everPlayed = true;
    }),
    stopAsync: jest.fn(async () => void (sound.playing = false)),
    unloadAsync: jest.fn(async () => {
      sound.playing = false;
      sound.unloaded = true;
    }),
    setOnPlaybackStatusUpdate: jest.fn(),
  };
  mockSounds.push(sound);
  return sound;
}

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => undefined),
    Sound: {
      createAsync: jest.fn(async (_src: unknown, opts: { shouldPlay?: boolean }) => {
        const delay = mockCreateDelays.shift() ?? 0;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        return { sound: mockMakeSound(Boolean(opts?.shouldPlay)) };
      }),
    },
  },
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

const mockSpeakApi = jest.fn(async () => ({ audio_base64: 'AAAA' }));
jest.mock('../services/apiClient', () => ({
  ApiError: class ApiError extends Error {},
  api: { speak: (...args: unknown[]) => (mockSpeakApi as (...a: unknown[]) => unknown)(...args) },
}));

import { isRecordingActive, setRecordingActive, setSpeechMuted, speak, stopSpeaking } from '../services/speech';

const playingNow = () => mockSounds.filter((s) => s.playing && !s.unloaded);
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  mockSounds.length = 0;
  mockCreateDelays.length = 0;
  mockSpeakApi.mockClear();
  setSpeechMuted(false);
  setRecordingActive(false);
  await stopSpeaking();
});

describe('two spoken lines never play together', () => {
  it('a second speak() cancels the first, even when both are mid-flight', async () => {
    // First line's audio is slow to load, second is instant: the classic way
    // the older sentence arrives last and plays over the newer one.
    mockCreateDelays.push(80, 0);

    const first = speak('first sentence', 'en-IN');
    const second = speak('second sentence', 'en-IN');
    await Promise.all([first, second]);
    await settle();

    expect(playingNow()).toHaveLength(1);
  });

  it('five rapid speak() calls leave exactly one playing', async () => {
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((t) => speak(t, 'en-IN')));
    await settle();
    expect(playingNow()).toHaveLength(1);
  });

  it('a line cancelled WHILE its audio is loading never makes a sound at all', async () => {
    // `createAsync(..., { shouldPlay: true })` starts audio inside the call,
    // before the staleness check can run - so a sentence that had already been
    // replaced still leaked a blip of itself over the new one. Stale sounds
    // must be created paused and only started once they are known to be wanted.
    mockCreateDelays.push(80, 0);

    const stale = speak('stale sentence', 'en-IN');
    await new Promise((r) => setTimeout(r, 25)); // let it reach createAsync
    const current = speak('current sentence', 'en-IN');
    await Promise.all([stale, current]);
    await settle();

    const audible = mockSounds.filter((sound) => sound.everPlayed);
    expect(audible).toHaveLength(1);
    expect(playingNow()).toHaveLength(1);
  });

  it('stopSpeaking() cancels a line that has not started yet', async () => {
    mockCreateDelays.push(60);
    const pending = speak('about to be cancelled', 'en-IN');
    await stopSpeaking();
    await pending;
    await settle();
    expect(playingNow()).toHaveLength(0);
  });
});

describe('speech never plays over the microphone', () => {
  it('is blocked outright while recording', async () => {
    setRecordingActive(true);
    expect(await speak('hello', 'en-IN')).toBe(false);
    expect(playingNow()).toHaveLength(0);
  });

  it('starting a recording silences speech that is already playing', async () => {
    await speak('long prompt', 'en-IN');
    await settle();
    expect(playingNow()).toHaveLength(1);

    setRecordingActive(true);
    await settle();

    expect(playingNow()).toHaveLength(0);
  });

  it('a line that finishes loading AFTER recording began does not play', async () => {
    mockCreateDelays.push(60);
    const pending = speak('late prompt', 'en-IN');
    setRecordingActive(true);
    await pending;
    await settle();
    expect(playingNow()).toHaveLength(0);
  });

  it('speech resumes once recording ends', async () => {
    setRecordingActive(true);
    setRecordingActive(false);
    expect(await speak('after', 'en-IN')).toBe(true);
    await settle();
    expect(playingNow()).toHaveLength(1);
    expect(isRecordingActive()).toBe(false);
  });
});
