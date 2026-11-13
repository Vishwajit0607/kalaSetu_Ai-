import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { GlowingTimeline, type TimelineNode } from '@/components/ui/GlowingTimeline';
import { VoiceOrbRecorder } from '@/components/voice/VoiceOrbRecorder';
import { colors, radii, typography } from '@/theme/tokens';
import { api, ApiError } from '@/services/apiClient';
import { speak, stopSpeaking } from '@/services/speech';
import { useShallow } from 'zustand/react/shallow';
import { useCatalogDraftStore } from '@/store/useCatalogDraftStore';
import { useT, tFor } from '@/i18n';

/**
 * Screen 4 - Multilingual Voice Auto-Cataloger.
 *
 * The artisan holds the orb and talks about their product the way they would
 * to a customer standing in front of them. Three AI stages then run, and the
 * glowing timeline shows each one's *actual output*, not a spinner:
 *
 *   1. Saaras V4  -> the native-script transcript, verbatim
 *   2. Mayura     -> the Hindi and English translations
 *   3. Gemini     -> SEO title, description, HSN code, price band
 *
 * Showing the real intermediate text matters more than it looks. When the
 * transcript is wrong, the artisan can see it is wrong at stage 1 and re-record
 * instead of discovering a nonsense listing three screens later.
 */

type PreviewTab = 'hi' | 'en';

export default function CatalogVoiceScreen() {
  const router = useRouter();
  const { t, lang: language, isEnglish } = useT();

  // Only the fields this screen renders. A bare `useCatalogDraftStore()` returns
  // a new object on every `set`, re-rendering this screen (and re-running any
  // effect that depended on it) whenever *any* draft field changed anywhere.
  const draft = useCatalogDraftStore(
    useShallow((state) => ({
      stage: state.stage,
      rawImageUri: state.rawImageUri,
      enhancedImageUrl: state.enhancedImageUrl,
      nativeTranscript: state.nativeTranscript,
      hindiText: state.hindiText,
      englishText: state.englishText,
      catalog: state.catalog,
    })),
  );

  const [busy, setBusy] = useState(false);
  // null = follow the artisan's language. It was `useState(isEnglish ? ...)`,
  // which froze at first render and ignored a later language change.
  const [tabOverride, setTab] = useState<PreviewTab | null>(null);
  const tab: PreviewTab = tabOverride ?? (isEnglish ? 'en' : 'hi');
  const [error, setError] = useState<string | null>(null);
  // True when the AI providers were down and the server returned a basic draft.
  const [degraded, setDegraded] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (draft.enhancedImageUrl && !draft.nativeTranscript) {
      void speak(t('voice.prompt'), language);
    }
    return () => {
      void stopSpeaking();
    };
  }, [draft.enhancedImageUrl, draft.nativeTranscript, language, t]);

  /** Step 3 on its own, so a failure here never forces a re-record. */
  const generate = useCallback(
    async (transcript: string, imageUrl: string, spokenLang?: string) => {
      const activeLang = spokenLang || language;
      const isEng = activeLang === 'en-IN';
      const result = await api.generateCatalog({
        enhanced_image_url: imageUrl,
        native_transcript: transcript,
        language_code: activeLang,
      });

      // No pricing here by design: costs have not been entered yet, and the
      // pricing screen computes it from the artisan's real numbers.
      useCatalogDraftStore.getState().setCatalog(result.catalog);
      setDegraded(result.degraded);

      const title = isEng
        ? (result.catalog.title_en || result.catalog.title_hi)
        : (result.catalog.title_hi || result.catalog.title_en);

      const message = result.degraded
        ? tFor(activeLang)('voice.degraded')
        : tFor(activeLang)('voice.ready', { title });

      // Stop any lingering audio and play output voice matching the language
      await stopSpeaking();
      void speak(message, activeLang);
    },
    [language],
  );

  const reportFailure = useCallback(
    (caught: unknown) => {
      // The client's errors already say the truthful thing in the artisan's
      // language: no internet, taking too long, or the server's own message.
      const message = caught instanceof ApiError ? caught.spokenHi : t('voice.failed');
      setError(message);
      useCatalogDraftStore.getState().setError(message);
      void speak(message, language);
    },
    [language, t],
  );

  /**
   * Run the whole pipeline from one voice note. Each stage writes to the draft
   * store, which is what drives the timeline - so a failure part-way leaves the
   * completed stages visible and the last one retryable.
   */
  const runPipeline = useCallback(
    async ({ uri, durationMs }: { uri: string; durationMs: number }) => {
      if (inFlight.current) return;

      const imageUrl = useCatalogDraftStore.getState().enhancedImageUrl;
      if (!imageUrl) {
        void speak(t('voice.needPhotoFirst'), language);
        return;
      }

      inFlight.current = true;
      setBusy(true);
      setError(null);
      setDegraded(false);

      // A new recording starts clean. Otherwise the previous attempt's
      // transcript and listing stay on screen, marked complete, while the new
      // one is still running.
      const store = useCatalogDraftStore.getState();
      store.resetVoice();
      store.setStage('transcribing');

      try {
        // Stop any background speech before processing
        await stopSpeaking();

        /* Node 1 - Saaras V4. `store` keeps the recording as the product's voice note. */
        const stt = await api.transcribe({ fileUri: uri, languageCode: language, store: true });

        if (!stt.transcript.trim()) {
          useCatalogDraftStore.getState().setStage('enhanced');
          void speak(t('voice.notHeard'), language);
          return;
        }

        const afterStt = useCatalogDraftStore.getState();
        afterStt.setVoiceNote({ url: stt.voice_note_url, durationMs });
        afterStt.setTranscript(stt.transcript);

        const detectedLang = stt.language_code || language;

        /* Node 2 - Mayura */
        const translations = await api.bilingual({
          text: stt.transcript,
          source_language_code: detectedLang,
        });
        useCatalogDraftStore.getState().setTranslations(translations);

        /* Node 3 - Gemini, with BharatCode behind it */
        await generate(stt.transcript, imageUrl, detectedLang);
      } catch (caught) {
        reportFailure(caught);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [generate, language, reportFailure, t],
  );

  const retryGeneration = useCallback(async () => {
    const { nativeTranscript, enhancedImageUrl } = useCatalogDraftStore.getState();
    if (inFlight.current || !nativeTranscript || !enhancedImageUrl) return;

    inFlight.current = true;
    setBusy(true);
    setError(null);
    setDegraded(false);
    useCatalogDraftStore.getState().setStage('generating');
    try {
      await generate(nativeTranscript, enhancedImageUrl);
    } catch (caught) {
      reportFailure(caught);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [generate, reportFailure]);

  const nodes = useMemo<TimelineNode[]>(() => {
    const stage = draft.stage;
    const transcribed = Boolean(draft.nativeTranscript);
    const translated = Boolean(draft.hindiText || draft.englishText);
    const generated = Boolean(draft.catalog);

    return [
      {
        label: t('voice.node.transcribed'),
        detail: draft.nativeTranscript ?? 'Sarvam Saaras V4',
        state: transcribed ? 'complete' : stage === 'transcribing' ? 'active' : 'pending',
      },
      {
        label: t('voice.node.translated'),
        detail: draft.englishText ?? 'Sarvam Mayura',
        state: translated ? 'complete' : stage === 'translating' ? 'active' : 'pending',
      },
      {
        label: t('voice.node.generated'),
        detail: draft.catalog
          ? `${draft.catalog.title_en} · HSN ${draft.catalog.hsn_code}`
          : 'Gemini · structured output',
        state: generated
          ? 'complete'
          : stage === 'generating'
            ? 'active'
            : stage === 'failed'
              ? 'failed'
              : 'pending',
      },
    ];
  }, [draft.catalog, draft.englishText, draft.hindiText, draft.nativeTranscript, draft.stage, t]);

  const title = tab === 'hi' ? draft.catalog?.title_hi : draft.catalog?.title_en;
  const description = tab === 'hi' ? draft.catalog?.description_hi : draft.catalog?.description_en;
  /** Transcript is there but the listing is not (or is only a basic draft): offer a retry. */
  const canRetry = !busy && Boolean(draft.nativeTranscript) && (!draft.catalog || degraded);

  return (
    <ScreenShell bottomInset={40}>
      <View className="flex-row items-center mt-2 mb-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Studio"
          hitSlop={12}
          onPress={() => router.push('/(tabs)/studio')}
          className="flex-row items-center py-1 pr-3"
        >
          <Ionicons name="chevron-back" size={24} color={colors.electricLime} />
          <Text className="font-heading ml-1" style={{ color: colors.electricLime, fontSize: typography.label }}>
            {t('common.back')}
          </Text>
        </Pressable>
      </View>

      <View style={{ marginTop: 6 }}>
        <SplitHeading
          subject={t('voice.title.subject')}
          action={t('voice.title.action')}
          size="title"
          subtitle={t('voice.subtitle')}
        />
      </View>

      {!draft.enhancedImageUrl ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take a product photo first"
          onPress={() => router.push('/(tabs)/studio')}
          className="mt-5 flex-row items-center rounded-bento p-4"
          style={{
            backgroundColor: colors.surfaceElevated,
            borderWidth: 1,
            borderColor: colors.borderHairline,
          }}
        >
          <Ionicons name="camera-outline" size={20} color={colors.electricLime} />
          <Text
            className="ml-3 flex-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label }}
          >
            {t('voice.needPhoto')}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMutedSage} />
        </Pressable>
      ) : null}

      <View className="mt-8 items-center">
        <VoiceOrbRecorder
          onComplete={(result) => void runPipeline(result)}
          languageCode={language}
          busy={busy}
          disabled={!draft.enhancedImageUrl}
          label={draft.nativeTranscript ? t('voice.speakAgain') : t('voice.holdToSpeak')}
          hint={t('voice.hint')}
        />
      </View>

      {/* AI pipeline timeline */}
      <View
        className="mt-8 rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <Text
          className="mb-4 font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
        >
          {t('voice.pipeline')}
        </Text>
        <GlowingTimeline nodes={nodes} />

        {/* The AI step can take a minute when the fast model is overloaded and the
            server falls back to a slower one. Say so, or it looks hung. */}
        {busy && draft.stage === 'generating' ? (
          <Text
            accessibilityRole="alert"
            className="mt-2 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label, lineHeight: 18 }}
          >
            {t('voice.waitHint')}
          </Text>
        ) : null}
      </View>

      {/* Bilingual preview tabs */}
      {draft.catalog ? (
        <View className="mt-7">
          <View className="flex-row" style={{ gap: 8 }}>
            {(['hi', 'en'] as PreviewTab[]).map((key) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityLabel={key === 'hi' ? 'Hindi preview' : 'English preview'}
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(key)}
                  className="px-5 py-2"
                  style={{
                    borderRadius: radii.pill,
                    minHeight: 44,
                    justifyContent: 'center',
                    backgroundColor: active ? colors.electricLime : colors.surfaceCharcoal,
                    borderWidth: 1,
                    borderColor: active ? colors.electricLime : colors.borderHairline,
                  }}
                >
                  <Text
                    className="font-heading"
                    style={{
                      color: active ? colors.textInverseDark : colors.textPureWhite,
                      fontSize: typography.label + 1,
                    }}
                  >
                    {key === 'hi' ? 'हिन्दी' : 'English'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View
            className="mt-4 rounded-bento p-5"
            style={{
              backgroundColor: colors.surfaceElevated,
              borderWidth: 1,
              borderColor: colors.borderHairline,
            }}
          >
            <View className="flex-row items-start">
              <Text
                className="flex-1 font-display"
                style={{ color: colors.textPureWhite, fontSize: typography.heading, lineHeight: 26 }}
              >
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Listen to this description"
                hitSlop={10}
                onPress={() =>
                  void speak(
                    `${title}. ${description}`,
                    tab === 'hi' ? 'hi-IN' : 'en-IN',
                  )
                }
                style={{
                  width: 40,
                  height: 40,
                  marginLeft: 12,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(168, 235, 52, 0.14)',
                }}
              >
                <Ionicons name="volume-high" size={18} color={colors.electricLime} />
              </Pressable>
            </View>

            <Text
              className="mt-3 font-body"
              style={{ color: colors.textMutedSage, fontSize: typography.body - 1, lineHeight: 22 }}
            >
              {description}
            </Text>

            {/* SEO tags */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingTop: 16 }}
            >
              {draft.catalog.seo_tags.map((seoTag) => (
                <View
                  key={seoTag}
                  className="px-3 py-1"
                  style={{
                    borderRadius: radii.pill,
                    borderWidth: 1,
                    borderColor: colors.borderHairline,
                  }}
                >
                  <Text
                    className="font-body"
                    style={{ color: colors.electricLime, fontSize: typography.label - 2 }}
                  >
                    #{seoTag}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View className="mt-4 flex-row items-center" style={{ gap: 16 }}>
              <MetaChip label="HSN" value={draft.catalog.hsn_code} />
              <MetaChip
                label={t('voice.complexity')}
                value={`${draft.catalog.craft_complexity_score}/10`}
              />
            </View>
          </View>

          {/* Continue to pricing */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue to the pricing assistant"
            onPress={() => router.push('/(tabs)/pricing-engine')}
            className="mt-6 flex-row items-center rounded-bento p-5"
            style={{
              backgroundColor: colors.surfaceCharcoal,
              borderWidth: 1.5,
              borderColor: colors.electricLime,
            }}
          >
            <View className="flex-1 pr-4">
              <Text
                className="font-heading"
                style={{ color: colors.textPureWhite, fontSize: typography.body }}
              >
                {t('voice.nextTitle')}
              </Text>
              <Text
                className="mt-1 font-body"
                style={{ color: colors.textMutedSage, fontSize: typography.label }}
              >
                {t('voice.nextSub')}
              </Text>
            </View>
            <LimeCircleButton
              accessibilityLabel="Continue to the pricing assistant"
              onPress={() => router.push('/(tabs)/pricing-engine')}
            />
          </Pressable>
        </View>
      ) : null}

      {degraded && draft.catalog ? (
        <Text
          accessibilityRole="alert"
          className="mt-5 font-body"
          style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}
        >
          {t('voice.degraded')}
        </Text>
      ) : null}

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-5 font-body"
          style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}
        >
          {error}
        </Text>
      ) : null}

      {/* Recoverable without re-recording: the transcript is already saved. */}
      {canRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('studio.retry')}
          onPress={() => void retryGeneration()}
          className="mt-5 items-center justify-center"
          style={{ minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.electricLime }}
        >
          <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.body }}>
            {t('studio.retry')}
          </Text>
        </Pressable>
      ) : null}
    </ScreenShell>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text
        className="font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 3, letterSpacing: 0.8 }}
      >
        {label}
      </Text>
      <Text
        className="font-heading"
        style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
      >
        {value}
      </Text>
    </View>
  );
}
