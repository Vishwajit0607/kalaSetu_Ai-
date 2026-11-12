import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, motion, touch, typography } from '@/theme/tokens';
import { ensureMicPermission, startRecording, type RecordingHandle } from '@/services/audioRecorder';
import { setRecordingActive, speak, stopSpeaking } from '@/services/speech';
import { tFor } from '@/i18n';

/**
 * Voice Capture Orb.
 *
 * A pulsing electric-lime orb wrapped in a live Skia waveform. Press and hold
 * to record; release to submit. Hold-to-talk beats tap-to-start/tap-to-stop
 * here: it is the same gesture as a WhatsApp voice note, which is the one
 * digital interaction this user group already knows cold.
 *
 * The waveform is a 48-sample ring buffer redrawn as one Skia path. Drawing it
 * as 48 animated Views would blow the frame budget on the handsets this is
 * built for.
 */

const SAMPLE_COUNT = 48;
const MIN_RECORDING_MS = 700;

export interface VoiceOrbRecorderProps {
  onComplete: (result: { uri: string; durationMs: number }) => void;
  /** Spoken before recording starts, in the artisan's language. */
  promptText?: string;
  languageCode?: string;
  disabled?: boolean;
  /** Replaces the mic glyph when the parent is busy transcribing. */
  busy?: boolean;
  label?: string;
  hint?: string;
}

export function VoiceOrbRecorder({
  onComplete,
  promptText,
  languageCode = 'hi-IN',
  disabled = false,
  busy = false,
  label,
  hint,
}: VoiceOrbRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const t = tFor(languageCode);
  const handleRef = useRef<RecordingHandle | null>(null);
  /** Is the finger still down? `begin()` awaits several things; the press can end before it finishes. */
  const pressedRef = useRef(false);
  const startingRef = useRef(false);
  const startedAtRef = useRef(0);
  const samplesRef = useRef<number[]>(new Array(SAMPLE_COUNT).fill(0));

  const amplitude = useSharedValue(0);
  const orbScale = useSharedValue(1);
  const [, forceRedraw] = useState(0);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: orbScale.value }],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.1 + amplitude.value * 0.4,
    transform: [{ scale: 1 + amplitude.value * 0.22 }],
  }));

  const pushSample = useCallback((value: number) => {
    const next = samplesRef.current.slice(1);
    next.push(value);
    samplesRef.current = next;
    // One setState per 100ms meter tick - cheap, and keeps Skia in sync.
    forceRedraw((n) => n + 1);
  }, []);

  const begin = useCallback(async () => {
    pressedRef.current = true;
    if (disabled || busy || recording || startingRef.current) return;
    startingRef.current = true;

    // Claim the microphone *now*, synchronously, before any await. Until this
    // is set, nothing stops a spoken line from starting during the permission
    // check below and playing straight into the take.
    setRecordingActive(true);

    try {
      await stopSpeaking();

      const granted = await ensureMicPermission();
      if (!granted) {
        setPermissionDenied(true);
        // Release first: while the flag is set, speak() refuses to speak, so
        // the "please allow the microphone" line would be silently dropped.
        setRecordingActive(false);
        void speak(t('orb.micDenied'), languageCode);
        return;
      }
      setPermissionDenied(false);

      // Released while we were checking permission: it was a tap, not a take.
      if (!pressedRef.current) {
        setRecordingActive(false);
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      orbScale.value = withSpring(1.08, motion.springy);

      const handle = await startRecording((value, duration) => {
        amplitude.value = withTiming(value, { duration: 90 });
        pushSample(value);
        setDurationMs(duration);
      });

      // The finger lifted while the mic was opening. `finish()` already ran and
      // found nothing to stop, so without this the recording would start after
      // release and run until the screen unmounted - mic open, app muted.
      if (!pressedRef.current) {
        await handle.cancel();
        orbScale.value = withSpring(1, motion.springy);
        return;
      }

      handleRef.current = handle;
      startedAtRef.current = Date.now();
      setRecording(true);
    } catch {
      // Mic unavailable or the recorder failed. Never leave the app muted.
      setRecordingActive(false);
      orbScale.value = withSpring(1, motion.springy);
      void speak(t('err.generic'), languageCode);
    } finally {
      startingRef.current = false;
    }
  }, [amplitude, busy, disabled, languageCode, orbScale, pushSample, recording, t]);

  const finish = useCallback(async () => {
    pressedRef.current = false;
    const handle = handleRef.current;
    if (!handle) return;

    handleRef.current = null;
    setRecording(false);
    orbScale.value = withSpring(1, motion.springy);
    amplitude.value = withTiming(0, { duration: motion.base });

    const elapsed = Date.now() - startedAtRef.current;

    // A stray tap is not a voice note. Discard and say so.
    if (elapsed < MIN_RECORDING_MS) {
      await handle.cancel();
      samplesRef.current = new Array(SAMPLE_COUNT).fill(0);
      setDurationMs(0);
      void speak(t('orb.holdAndSpeak'), languageCode);
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const result = await handle.stop();
      samplesRef.current = new Array(SAMPLE_COUNT).fill(0);
      setDurationMs(0);
      onComplete({ uri: result.uri, durationMs: result.durationMs });
    } catch {
      // The recorder's own `finally` has already released the microphone.
      samplesRef.current = new Array(SAMPLE_COUNT).fill(0);
      setDurationMs(0);
      void speak(t('err.generic'), languageCode);
    }
  }, [amplitude, languageCode, onComplete, orbScale, t]);

  // Never leave the mic stream open or speech playing if the screen unmounts mid-recording.
  useEffect(
    () => () => {
      void handleRef.current?.cancel();
      void stopSpeaking();
    },
    [],
  );

  const orbSize = touch.voiceOrb;
  const waveSize = orbSize + 56;

  return (
    <View className="items-center">
      <View style={{ width: waveSize, height: waveSize }} className="items-center justify-center">
        <Animated.View
          pointerEvents="none"
          style={[
            haloStyle,
            {
              position: 'absolute',
              width: waveSize,
              height: waveSize,
              borderRadius: waveSize / 2,
              backgroundColor: colors.ambientOliveGlow,
            },
          ]}
        />

        {/* Live circular waveform */}
        <Canvas style={{ position: 'absolute', width: waveSize, height: waveSize }}>
          <Group>
            <Path
              path={buildWaveformPath(samplesRef.current, waveSize, orbSize / 2 + 6)}
              color={colors.electricLime}
              style="stroke"
              strokeWidth={2.5}
              strokeCap="round"
            />
          </Group>
        </Canvas>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label ?? 'Hold to speak'}
          accessibilityHint={hint ?? 'Press and hold, describe your product, then release'}
          accessibilityState={{ disabled: disabled || busy, busy }}
          disabled={disabled || busy}
          onPressIn={() => void begin()}
          onPressOut={() => void finish()}
          delayLongPress={120}
        >
          <Animated.View
            style={[
              orbStyle,
              {
                width: orbSize,
                height: orbSize,
                borderRadius: orbSize / 2,
                backgroundColor: disabled ? colors.surfaceElevated : colors.electricLime,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: recording ? 3 : 0,
                borderColor: colors.textPureWhite,
              },
            ]}
          >
            <Ionicons
              name={busy ? 'hourglass-outline' : recording ? 'radio-button-on' : 'mic'}
              size={orbSize * 0.38}
              color={disabled ? colors.textMutedSage : colors.textInverseDark}
            />
          </Animated.View>
        </Pressable>
      </View>

      <Text
        className="mt-4 text-center font-heading"
        style={{ color: colors.textPureWhite, fontSize: typography.body }}
      >
        {recording
          ? formatDuration(durationMs)
          : (label ?? t('orb.holdToSpeak'))}
      </Text>

      <Text
        className="mt-1 text-center font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label }}
      >
        {permissionDenied
          ? t('orb.micNeeded')
          : recording
            ? t('orb.releaseToFinish')
            : (hint ?? t('orb.hint'))}
      </Text>
    </View>
  );
}

/**
 * Build the circular waveform as a single path: each sample is a radial spoke
 * whose length tracks amplitude.
 */
function buildWaveformPath(samples: number[], canvasSize: number, innerRadius: number) {
  const path = Skia.Path.Make();
  const center = canvasSize / 2;
  const maxSpoke = canvasSize / 2 - innerRadius - 3;

  samples.forEach((sample, index) => {
    const angle = (index / samples.length) * Math.PI * 2 - Math.PI / 2;
    const spoke = Math.max(2, sample * maxSpoke);
    const x1 = center + Math.cos(angle) * innerRadius;
    const y1 = center + Math.sin(angle) * innerRadius;
    const x2 = center + Math.cos(angle) * (innerRadius + spoke);
    const y2 = center + Math.sin(angle) * (innerRadius + spoke);
    path.moveTo(x1, y1);
    path.lineTo(x2, y2);
  });

  return path;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
