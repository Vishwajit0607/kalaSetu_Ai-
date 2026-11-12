import { Skia } from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system';

/**
 * Exposure check for craft photos.
 *
 * The single biggest cause of a bad listing photo is an underexposed frame -
 * shot indoors on a loom floor at dusk - and no amount of AI relighting
 * recovers detail that was never captured. So the frame is graded immediately
 * after the shutter and the artisan is told, out loud, to move toward a window
 * before they go any further.
 *
 * Implementation note: this is a post-capture grade, not a live viewfinder
 * meter. `expo-camera` exposes no per-frame callback - a true real-time meter
 * needs a frame processor (react-native-vision-camera). Grading the captured
 * frame costs one Skia decode and catches the same failure a beat later,
 * without pulling in a second camera stack.
 */

export type ExposureGrade = 'too-dark' | 'dark' | 'good' | 'blown';

export interface LuminanceReading {
  /** Mean relative luminance, 0..1. */
  luminance: number;
  /** Fraction of sampled pixels that are near-black. */
  clippedShadows: number;
  /** Fraction of sampled pixels that are near-white. */
  clippedHighlights: number;
  grade: ExposureGrade;
  /** Hindi guidance for TTS; empty when the frame is fine. */
  spokenHi: string;
}

/** Sample every Nth pixel - a 12MP decode graded in full would block the UI. */
const SAMPLE_STRIDE = 97;

export async function gradeExposure(fileUri: string): Promise<LuminanceReading | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const data = Skia.Data.fromBase64(base64);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) return null;

    const pixels = image.readPixels();
    if (!pixels) return null;

    let total = 0;
    let samples = 0;
    let shadows = 0;
    let highlights = 0;

    // readPixels returns RGBA bytes; stride must stay 4-aligned to keep the
    // channel offsets meaningful.
    const stride = SAMPLE_STRIDE * 4;
    for (let i = 0; i + 2 < pixels.length; i += stride) {
      const r = Number(pixels[i]) / 255;
      const g = Number(pixels[i + 1]) / 255;
      const b = Number(pixels[i + 2]) / 255;

      // Rec. 709 relative luminance.
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      total += luma;
      samples += 1;
      if (luma < 0.06) shadows += 1;
      if (luma > 0.97) highlights += 1;
    }

    if (samples === 0) return null;

    const luminance = total / samples;
    const clippedShadows = shadows / samples;
    const clippedHighlights = highlights / samples;

    return {
      luminance,
      clippedShadows,
      clippedHighlights,
      ...describe(luminance, clippedShadows, clippedHighlights),
    };
  } catch {
    // A grading failure must never block the capture flow.
    return null;
  }
}

function describe(
  luminance: number,
  clippedShadows: number,
  clippedHighlights: number,
): { grade: ExposureGrade; spokenHi: string } {
  if (luminance < 0.16 || clippedShadows > 0.45) {
    return {
      grade: 'too-dark',
      spokenHi:
        'फोटो बहुत अंधेरी है। खिड़की या दरवाज़े के पास जाकर दोबारा फोटो खींचिए।',
    };
  }

  if (clippedHighlights > 0.3) {
    return {
      grade: 'blown',
      spokenHi: 'रोशनी बहुत तेज़ है। सीधी धूप से हटकर फोटो खींचिए।',
    };
  }

  if (luminance < 0.28) {
    return {
      grade: 'dark',
      spokenHi: 'थोड़ी और रोशनी हो तो फोटो बेहतर आएगी।',
    };
  }

  return { grade: 'good', spokenHi: '' };
}

/** Ring colour for the stage caption, mapped off the grade. */
export function gradeColor(grade: ExposureGrade | null): string {
  switch (grade) {
    case 'too-dark':
      return '#E4572E';
    case 'dark':
    case 'blown':
      return '#E4A72E';
    default:
      return '#A8EB34';
  }
}
