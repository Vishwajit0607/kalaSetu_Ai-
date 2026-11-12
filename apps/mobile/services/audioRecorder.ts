import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { setRecordingActive, stopSpeaking } from './speech';

/**
 * Voice note recorder.
 *
 * Tuned for Saaras V4: 16kHz mono is what the model wants, and it also cuts
 * the upload to roughly a tenth of a stereo 44.1kHz take - which matters when
 * the artisan is on a 2G edge cell.
 *
 * `onMeter` feeds the Skia waveform in VoiceOrbRecorder. It fires every 100ms
 * with a 0..1 amplitude, already normalised from the platform dBFS range.
 */

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

/** dBFS floor treated as silence. Below this the orb sits still. */
const SILENCE_DB = -55;

export interface RecordingHandle {
  stop: () => Promise<{ uri: string; durationMs: number; sizeBytes: number }>;
  cancel: () => Promise<void>;
}

let activeRecording: Audio.Recording | null = null;

export async function ensureMicPermission(): Promise<boolean> {
  const { granted } = await Audio.requestPermissionsAsync();
  return granted;
}

export async function startRecording(
  onMeter?: (amplitude: number, durationMs: number) => void,
): Promise<RecordingHandle> {
  // Silence and prevent any speech playback immediately so recording has zero background AI sound
  setRecordingActive(true);

  try {
    await stopSpeaking();

    if (activeRecording) {
      // Defensive: a double-tap on the orb must not open two mic streams.
      await activeRecording.stopAndUnloadAsync().catch(() => undefined);
      activeRecording = null;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(RECORDING_OPTIONS);

    recording.setOnRecordingStatusUpdate((status) => {
      if (!status.isRecording || !onMeter) return;
      const db = status.metering ?? SILENCE_DB;
      // Map [-55, 0] dBFS to [0, 1], clamped.
      const amplitude = Math.max(0, Math.min(1, (db - SILENCE_DB) / -SILENCE_DB));
      onMeter(amplitude, status.durationMillis ?? 0);
    });
    recording.setProgressUpdateInterval(100);

    await recording.startAsync();
    activeRecording = recording;
    return buildHandle(recording);
  } catch (error) {
    // The mic never opened. The "recording" flag above is what mutes every
    // spoken prompt, so it must not outlive the attempt - left set, a single
    // failed start silenced the whole app until it was restarted.
    setRecordingActive(false);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined);
    throw error;
  }
}

function buildHandle(recording: Audio.Recording): RecordingHandle {
  return {
    // The "recording" flag is released only once the microphone is actually
    // closed (in `finally`). Clearing it first let a spoken line start on a
    // mic that was still open - the take picked up the app's own voice.
    stop: async () => {
      try {
        await recording.stopAndUnloadAsync();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        activeRecording = null;

        const uri = recording.getURI();
        if (!uri) throw new Error('Recording produced no file');

        const status = await recording.getStatusAsync();
        const info = await FileSystem.getInfoAsync(uri, { size: true });

        return {
          uri,
          durationMs: status.durationMillis ?? 0,
          sizeBytes: info.exists && 'size' in info ? info.size : 0,
        };
      } finally {
        activeRecording = null;
        setRecordingActive(false);
      }
    },
    cancel: async () => {
      try {
        await recording.stopAndUnloadAsync().catch(() => undefined);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined);
        const uri = recording.getURI();
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
      } finally {
        activeRecording = null;
        setRecordingActive(false);
      }
    },
  };
}

export function isRecording(): boolean {
  return activeRecording !== null;
}
