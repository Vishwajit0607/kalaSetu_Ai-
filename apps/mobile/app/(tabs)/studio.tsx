import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { HaloProductStage, StageActionPill } from '@/components/ui/HaloProductStage';
import { BackdropPresetBar } from '@/components/studio/BackdropPresetBar';
import { BeforeAfterSlider } from '@/components/studio/BeforeAfterSlider';
import { colors, radii, typography } from '@/theme/tokens';
import { api, ApiError } from '@/services/apiClient';
import { speak } from '@/services/speech';
import { gradeColor, gradeExposure, type ExposureGrade } from '@/services/luminance';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useCatalogDraftStore } from '@/store/useCatalogDraftStore';
import { useT } from '@/i18n';

/**
 * Screen 3 - AI Photo Studio & Halo Stage.
 *
 * Two modes in one screen: a viewfinder with a lime alignment ring and a live
 * luminance read-out, then the halo stage once a frame is captured.
 *
 * Exposure grading is the quiet workhorse here. Craft photos fail for one
 * reason above all others - shot indoors on a loom floor at dusk - and no
 * amount of AI relighting rescues a frame with no signal in it. So the frame is
 * graded the instant the shutter fires: an underexposed capture turns the ring
 * amber and the app *says* "move towards the light" and offers a retake, rather
 * than silently returning a muddy cutout.
 *
 * See services/luminance.ts on why this grades the captured frame rather than
 * metering the live preview.
 */

type StudioMode = 'viewfinder' | 'stage';

/**
 * Longest edge sent to the server. Photoroom's output is capped at 1600px, so
 * anything larger is pure upload cost: a raw 12MP frame is 4-6 MB, which on a
 * rural uplink was the main reason the studio step timed out. At 1600px it is
 * a few hundred KB.
 */
const MAX_UPLOAD_EDGE = 1600;

export default function StudioScreen() {
  const router = useRouter();
  const offline = useArtisanStore((state) => state.offline);
  const { t, lang: language } = useT();

  // Select fields individually. Subscribing to the whole store hands this
  // component a new object on every change, and was how callbacks ended up
  // reading the setting from *before* the tap that triggered them.
  const rawImageUri = useCatalogDraftStore((state) => state.rawImageUri);
  const enhancedImageUrl = useCatalogDraftStore((state) => state.enhancedImageUrl);
  const studioDegraded = useCatalogDraftStore((state) => state.studioDegraded);
  const backdrop = useCatalogDraftStore((state) => state.backdrop);
  const relight = useCatalogDraftStore((state) => state.relight);
  const shadow = useCatalogDraftStore((state) => state.shadow);

  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  // Derived from the draft, not held in local state. It used to be a `useState`
  // that was set once and never synced back: after a product was committed the
  // draft reset, but this tab stayed on an empty stage until the app restarted.
  const mode: StudioMode = rawImageUri ? 'stage' : 'viewfinder';

  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [exposure, setExposure] = useState<ExposureGrade | null>(null);

  // Every edit spends a Photoroom credit, so concurrent calls are never wanted.
  const inFlight = useRef(false);

  useEffect(() => {
    // Only coach the framing when the camera is actually showing - this used to
    // re-speak it every time the artisan came back to a finished capture.
    if (mode === 'viewfinder') void speak(t('studio.framingPrompt'), language);
  }, [mode, language, t]);

  /**
   * Run the studio edit.
   *
   * `overrides` are applied to the draft first and then read back through
   * `getState()`: zustand's `set` is synchronous, so the edit sees the setting
   * the artisan just tapped. Reading from a render-time snapshot instead sent
   * the *previous* backdrop/toggle to the server on every change.
   */
  const runEdit = useCallback(
    async (overrides: { backdrop?: string; relight?: boolean; shadow?: boolean } = {}) => {
      if (inFlight.current) return;

      const store = useCatalogDraftStore.getState();
      const captureUri = store.rawImageUri;
      if (!captureUri) return;
      if (Object.keys(overrides).length > 0) store.setStudioOptions(overrides);

      const current = useCatalogDraftStore.getState();
      inFlight.current = true;
      setEnhancing(true);
      setError(null);
      current.setStage('enhancing');

      try {
        const result = await api.editPhoto({
          // First edit uploads the capture; later edits reuse the stored copy.
          ...(current.rawImageUrl
            ? {
                rawImageUrl: current.rawImageUrl,
                // Not when the last edit degraded: then the "enhanced" URL is
                // the raw capture itself, which must not be deleted.
                ...(current.enhancedImageUrl && !current.studioDegraded
                  ? { previousEnhancedUrl: current.enhancedImageUrl }
                  : {}),
              }
            : { fileUri: captureUri }),
          backdrop: current.backdrop,
          relight: current.relight,
          shadow: current.shadow,
        });

        useCatalogDraftStore.getState().setUploaded({
          rawUrl: result.raw_image_url,
          enhancedUrl: result.enhanced_image_url,
          degraded: result.degraded,
        });
        void speak(result.degraded ? t('studio.degraded') : t('studio.enhanced'), language);
      } catch (caught) {
        // The client's own errors already say the truthful thing - "no
        // internet" or "that is taking too long" - in the artisan's language.
        const message = caught instanceof ApiError ? caught.spokenHi : t('studio.enhanceFailed');
        setError(message);
        useCatalogDraftStore.getState().setError(message);
        void speak(message, language);
      } finally {
        inFlight.current = false;
        setEnhancing(false);
      }
    },
    [language, t],
  );

  const capture = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || inFlight.current) return;

    try {
      const photo = await camera.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!photo?.uri) throw new Error('Camera returned no image');

      // Shrink before anything else touches it: the exposure check decodes the
      // pixels (a 12MP frame is ~48MB of them) and the upload sends the file.
      const longEdge = Math.max(photo.width, photo.height);
      const small =
        longEdge > MAX_UPLOAD_EDGE
          ? await ImageManipulator.manipulateAsync(
              photo.uri,
              [{ resize: photo.width >= photo.height ? { width: MAX_UPLOAD_EDGE } : { height: MAX_UPLOAD_EDGE } }],
              { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
            )
          : { uri: photo.uri };

      // The full-resolution original is now dead weight in the cache.
      if (small.uri !== photo.uri) {
        void FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => undefined);
      }

      useCatalogDraftStore.getState().setCapture(small.uri);
      setError(null);

      // Grade the exposure before spending a Photoroom call on a frame that
      // cannot be saved. A too-dark capture stops here and asks for a retake.
      const reading = await gradeExposure(small.uri);
      setExposure(reading?.grade ?? null);

      if (reading?.grade === 'too-dark') {
        void speak(reading.spokenHi, language);
        setError(t('studio.tooDarkError'));
        return;
      }

      void speak(reading?.spokenHi || t('studio.captured'), language);
      await runEdit();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Capture failed';
      setError(message);
      void speak(t('studio.captureFailed'), language);
    }
  }, [language, runEdit, t]);

  const retake = useCallback(() => {
    useCatalogDraftStore.getState().reset();
    setExposure(null);
    setError(null);
    setShowComparison(false);
  }, []);

  /* ----------------------------------------------------------- viewfinder */

  if (mode === 'viewfinder') {
    if (!permission?.granted) {
      return (
        <ScreenShell>
          <View style={{ marginTop: 24 }}>
            <SplitHeading
              subject={t('studio.permTitle.subject')}
              action={t('studio.permTitle.action')}
              size="title"
              subtitle={t('studio.permSubtitle')}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Allow camera access"
            onPress={() => void requestPermission()}
            className="mt-8 items-center justify-center"
            style={{
              minHeight: 56,
              borderRadius: radii.pill,
              backgroundColor: colors.electricLime,
            }}
          >
            <Text
              className="font-heading"
              style={{ color: colors.textInverseDark, fontSize: typography.body }}
            >
              {t('studio.allowCamera')}
            </Text>
          </Pressable>
        </ScreenShell>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: colors.canvasObsidian }}>
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing="back"
          autofocus="on"
        />

        {/* Alignment ring overlay */}
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <View
            style={{
              width: 280,
              height: 280,
              borderRadius: 140,
              borderWidth: 2,
              borderColor: colors.electricLime,
              opacity: 0.85,
            }}
          />
          <Text
            className="mt-6 text-center font-heading"
            style={{
              color: colors.textPureWhite,
              fontSize: typography.body - 1,
              textShadowColor: 'rgba(0,0,0,0.8)',
              textShadowRadius: 6,
            }}
          >
            {t('studio.alignHint')}
          </Text>
        </View>

        {/* Shutter row */}
        <View
          className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-6 pb-10 pt-5"
          style={{ backgroundColor: 'rgba(6, 7, 5, 0.86)' }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back to dashboard"
            onPress={() => router.back()}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={28} color={colors.textMutedSage} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take the product photo"
            onPress={() => void capture()}
            style={{
              width: 78,
              height: 78,
              borderRadius: 39,
              backgroundColor: colors.electricLime,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 4,
              borderColor: colors.canvasObsidian,
            }}
          >
            <Ionicons name="camera" size={32} color={colors.textInverseDark} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hear photography tips"
            onPress={() =>
              void speak(t('studio.tips'), language)
            }
            hitSlop={12}
          >
            <Ionicons name="help-circle-outline" size={28} color={colors.textMutedSage} />
          </Pressable>
        </View>
      </View>
    );
  }

  /* ---------------------------------------------------------- halo stage */

  return (
    <ScreenShell bottomInset={40}>
      <View style={{ marginTop: 12 }}>
        <SplitHeading
          subject={t('studio.title.subject')}
          action={t('studio.title.action')}
          size="title"
          subtitle={
            studioDegraded ? t('studio.subtitleDegraded') : t('studio.subtitleReady')
          }
        />
      </View>

      {exposure && exposure !== 'good' ? (
        <View
          accessibilityRole="alert"
          className="mt-5 flex-row items-center rounded-pill px-4 py-2 self-start"
          style={{
            backgroundColor: colors.surfaceCharcoal,
            borderWidth: 1,
            borderColor: gradeColor(exposure),
          }}
        >
          <Ionicons name="bulb-outline" size={16} color={gradeColor(exposure)} />
          <Text
            className="ml-2 font-heading"
            style={{ color: gradeColor(exposure), fontSize: typography.label }}
          >
            {exposure === 'too-dark'
              ? t('studio.chip.tooDark')
              : exposure === 'blown'
                ? t('studio.chip.blown')
                : t('studio.chip.dark')}
          </Text>
        </View>
      ) : null}

      <View className="mt-6">
        <HaloProductStage
          imageUri={enhancedImageUrl ?? rawImageUri}
          processing={enhancing}
          caption={
            enhancing
              ? t('studio.caption.working')
              : exposure === 'too-dark'
                ? t('studio.caption.tooDark')
                : exposure === 'dark'
                  ? t('studio.caption.dark')
                  : studioDegraded
                    ? t('studio.caption.later')
                    : t('studio.caption.ready')
          }
          actions={
            <>
              <StageActionPill
                label="Remove background"
                active
                onPress={() => {
                  // Background removal is always on, so tapping this again would
                  // just spend a credit to produce the same image. It only
                  // re-runs when the last attempt failed or fell back.
                  if (studioDegraded || !enhancedImageUrl) void runEdit();
                  else void speak(t('studio.bgDone'), language);
                }}
                icon={<Ionicons name="cut-outline" size={18} color={colors.textInverseDark} />}
              />
              <StageActionPill
                label="Studio relight"
                active={relight}
                onPress={() => void runEdit({ relight: !relight })}
                icon={
                  <Ionicons
                    name="sunny-outline"
                    size={18}
                    color={relight ? colors.textInverseDark : colors.electricLime}
                  />
                }
              />
              <StageActionPill
                label="Shadow depth"
                active={shadow}
                showConnector={false}
                onPress={() => void runEdit({ shadow: !shadow })}
                icon={
                  <Ionicons
                    name="contrast-outline"
                    size={18}
                    color={shadow ? colors.textInverseDark : colors.electricLime}
                  />
                }
              />
            </>
          }
        />
      </View>

      {/* Before / after proof */}
      {rawImageUri && enhancedImageUrl && !studioDegraded ? (
        <View className="mt-7">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Compare the original and enhanced photo"
            onPress={() => setShowComparison((value) => !value)}
            className="mb-3 flex-row items-center"
          >
            <Ionicons
              name={showComparison ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color={colors.electricLime}
            />
            <Text
              className="ml-1.5 font-heading"
              style={{ color: colors.electricLime, fontSize: typography.label }}
            >
              {t('common.compare')}
            </Text>
          </Pressable>

          {showComparison ? (
            <BeforeAfterSlider
              beforeUri={rawImageUri}
              afterUri={enhancedImageUrl}
              height={260}
            />
          ) : null}
        </View>
      ) : null}

      <View className="mt-7">
        <BackdropPresetBar
          selected={backdrop}
          disabled={enhancing || offline}
          onSelect={(key) => void runEdit({ backdrop: key })}
        />
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-4 font-body"
          style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}
        >
          {error}
        </Text>
      ) : null}

      {/* A failed or skipped edit must be recoverable without retaking the photo. */}
      {!enhancing && !enhancedImageUrl && rawImageUri ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={exposure === 'too-dark' ? t('studio.useAnyway') : t('studio.retry')}
          onPress={() => void runEdit()}
          className="mt-4 items-center justify-center"
          style={{ minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.electricLime }}
        >
          <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.body }}>
            {exposure === 'too-dark' ? t('studio.useAnyway') : t('studio.retry')}
          </Text>
        </Pressable>
      ) : null}

      {/* Continue to voice cataloging */}
      <View
        className="mt-7 flex-row items-center rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <View className="flex-1 pr-4">
          <Text
            className="font-heading"
            style={{ color: colors.textPureWhite, fontSize: typography.body }}
          >
            {t('studio.nextTitle')}
          </Text>
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label }}
          >
            {t('studio.nextSub')}
          </Text>
        </View>

        {enhancing ? (
          <ActivityIndicator color={colors.electricLime} />
        ) : (
          <LimeCircleButton
            accessibilityLabel="Continue to voice cataloging"
            disabled={!enhancedImageUrl}
            onPress={() => router.push('/(tabs)/catalog-voice')}
          />
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retake the photo"
        onPress={retake}
        className="mt-4 items-center py-3"
      >
        <Text className="font-heading" style={{ color: colors.textMutedSage, fontSize: typography.label }}>
          {t('common.retake')}
        </Text>
      </Pressable>
    </ScreenShell>
  );
}
