import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { VoiceOrbRecorder } from '@/components/voice/VoiceOrbRecorder';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { extraPhotoUrls } from '@/services/extraPhotos';
import { api, ApiError, type PricingBreakdown } from '@/services/apiClient';
import { speak, stopSpeaking } from '@/services/speech';
import { parseSpokenCosts } from '@/services/costParser';
import { useShallow } from 'zustand/react/shallow';
import { useCatalogDraftStore } from '@/store/useCatalogDraftStore';
import { queryClient } from '@/lib/queryClient';
import { useT } from '@/i18n';

/**
 * Screen 5 - Intelligent Pricing Assistant.
 *
 * Cost in, two prices out, with the arithmetic shown. The reason the breakdown
 * is visible rather than hidden behind a single number is that artisans in
 * these clusters are routinely talked down by middlemen; a price you can
 * explain - out loud, in your own language - is a price you can hold.
 *
 * Sliders are deliberately huge and voice entry sits right next to them: the
 * artisan can say "चार सौ रुपये का कपड़ा, छह घंटे" instead of dragging.
 */

export default function PricingEngineScreen() {
  const router = useRouter();
  const { t, lang: language, isEnglish } = useT();

  // Field selectors, not the whole store. `recalculate` used to depend on the
  // entire store object, which is replaced on every `set` - including the
  // `setPricing` call inside `recalculate` itself. So once any cost was
  // entered it recalculated, updated the store, and recalculated again, about
  // every 420ms, for as long as the screen was open.
  const draft = useCatalogDraftStore(
    useShallow((state) => ({
      materialCostInr: state.materialCostInr,
      laborHours: state.laborHours,
      dimensionsCm: state.dimensionsCm,
      stockQuantity: state.stockQuantity,
      catalog: state.catalog,
      rawImageUrl: state.rawImageUrl,
    })),
  );
  const setCosting = useCatalogDraftStore((state) => state.setCosting);
  const setStockQuantity = useCatalogDraftStore((state) => state.setStockQuantity);

  // Primitives for the effect's dependency list, so it re-runs only when an
  // input actually changes.
  const { materialCostInr: material, laborHours: labor } = draft;
  const { length, width, height } = draft.dimensionsCm;
  const complexity = draft.catalog?.craft_complexity_score;
  const aiRetail = draft.catalog?.recommended_retail_inr;
  const aiWholesale = draft.catalog?.recommended_wholesale_inr;

  const [breakdown, setBreakdown] = useState<PricingBreakdown | null>(
    () => useCatalogDraftStore.getState().pricing,
  );
  const [rationale, setRationale] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // voice cost entry
  // True from the moment an input changes until its price arrives - including
  // the debounce. Committing in that window would save a price that does not
  // match the numbers on screen.
  const [calculating, setCalculating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    const store = useCatalogDraftStore.getState();

    // Nothing entered (or cleared back to zero): there is no price to show, and
    // leaving the last one up would be a price for numbers that no longer exist.
    if (material <= 0 && labor <= 0) {
      latestRequest.current += 1;
      setBreakdown(null);
      setRationale(null);
      setCalculating(false);
      store.setPricing(null);
      return;
    }

    const requestId = ++latestRequest.current;
    setCalculating(true);

    const handle = setTimeout(async () => {
      setError(null);
      try {
        const result = await api.price({
          material_cost_inr: material,
          labor_hours: labor,
          language_code: language,
          dimensions_cm: {
            // Only the packaging estimate uses these before the artisan has
            // set a size. The commit button still requires real ones.
            length: length || 30,
            width: width || 20,
            height: height || 2,
          },
          ...(complexity !== undefined ? { complexity_score: complexity } : {}),
          ...(aiRetail !== undefined ? { ai_retail_inr: aiRetail } : {}),
          ...(aiWholesale !== undefined ? { ai_wholesale_inr: aiWholesale } : {}),
        });

        // A slider dragged quickly fires several requests; a slow early one
        // must not overwrite the answer to the latest.
        if (requestId !== latestRequest.current) return;
        setBreakdown(result.breakdown);
        setRationale(result.rationale);
        useCatalogDraftStore.getState().setPricing(result.breakdown);
      } catch (caught) {
        if (requestId !== latestRequest.current) return;
        setError(caught instanceof ApiError ? caught.spokenHi : t('price.failed'));
      } finally {
        if (requestId === latestRequest.current) setCalculating(false);
      }
    }, 420);

    return () => clearTimeout(handle);
  }, [material, labor, length, width, height, language, complexity, aiRetail, aiWholesale, t]);

  useEffect(() => {
    return () => {
      void stopSpeaking();
    };
  }, []);

  // Pre-populate smart defaults so the artisan is never blocked from saving their product
  useEffect(() => {
    const store = useCatalogDraftStore.getState();
    const needsMaterial = store.materialCostInr <= 0;
    const needsLabor = store.laborHours <= 0;
    const needsLength = store.dimensionsCm.length <= 0;
    const needsWidth = store.dimensionsCm.width <= 0;

    if (needsMaterial || needsLabor || needsLength || needsWidth) {
      const suggestedMaterial = store.catalog?.recommended_wholesale_inr
        ? Math.max(100, Math.round(store.catalog.recommended_wholesale_inr * 0.35))
        : 250;

      store.setCosting({
        materialCostInr: needsMaterial ? suggestedMaterial : undefined,
        laborHours: needsLabor ? 4 : undefined,
        dimensionsCm: {
          length: needsLength ? 30 : undefined,
          width: needsWidth ? 20 : undefined,
          height: store.dimensionsCm.height || 2,
        },
      });
    }
  }, []);

  /**
   * Parse spoken cost entry. Handles "400 rupaye ka kapda, 6 ghante" and the
   * Devanagari-digit forms Saaras returns for some languages.
   */
  const handleVoiceCost = useCallback(
    async ({ uri }: { uri: string }) => {
      setBusy(true);
      await stopSpeaking();
      try {
        const { transcript } = await api.transcribe({ fileUri: uri, languageCode: language });
        const parsed = parseSpokenCosts(transcript);

        if (!parsed.materialCostInr && !parsed.laborHours) {
          void speak(t('price.voiceNotUnderstood'), language);
          return;
        }

        const current = useCatalogDraftStore.getState();
        setCosting(parsed);
        void speak(
          t('price.voiceCaptured', {
            cost: parsed.materialCostInr ?? current.materialCostInr,
            hours: parsed.laborHours ?? current.laborHours,
          }),
          language,
        );
      } catch {
        void speak(t('price.voiceUnclear'), language);
      } finally {
        setBusy(false);
      }
    },
    [language, setCosting, t],
  );

  const speakRationale = useCallback(() => {
    const text = rationale ?? draft.catalog?.pricing_rationale;
    if (text) void speak(text, language);
  }, [draft.catalog, rationale, language]);

  /** Commit the finished draft as a product. */
  const commit = useCallback(async () => {
    if (committing) return;

    const d = useCatalogDraftStore.getState();
    if (d.extraPhotos.some((photo) => photo.busy)) {
      setError(t('price.extrasBusy'));
      return;
    }
    if (!d.isCommittable() || !d.catalog || !d.pricing || !d.rawImageUrl || !d.enhancedImageUrl) {
      return;
    }

    setCommitting(true);
    setError(null);
    try {
      const product = await api.commitProduct({
        // Hosted URLs the server handed out - never this phone's file paths.
        raw_image_url: d.rawImageUrl,
        enhanced_image_url: d.enhancedImageUrl,
        gallery_image_urls: extraPhotoUrls(d.extraPhotos),
        voice_note_url: d.voiceNoteUrl,
        native_transcript: d.nativeTranscript,
        title_en: d.catalog.title_en,
        title_hi: d.catalog.title_hi,
        description_en: d.catalog.description_en,
        description_hi: d.catalog.description_hi,
        seo_tags: d.catalog.seo_tags,
        hsn_code: d.catalog.hsn_code,
        material_cost_inr: d.materialCostInr,
        labor_hours: d.laborHours,
        dimensions_cm: {
          length: d.dimensionsCm.length,
          width: d.dimensionsCm.width,
          // A flat item (a saree, a painting) has no meaningful height.
          height: d.dimensionsCm.height || 1,
        },
        recommended_retail_inr: d.pricing.recommended_retail_inr,
        recommended_wholesale_inr: d.pricing.recommended_wholesale_inr,
        stock_quantity: d.stockQuantity,
      });

      // The product must appear in the inventory grid, the dashboard counts and
      // the marketplace picker straight away. Their queries stay "fresh" for a
      // minute, so without this the new product was invisible until then.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['marketplace-status'] }),
        // The new product is also a bazaar listing, and the crafts filter may
        // have gained a category.
        queryClient.invalidateQueries({ queryKey: ['bazaar'] }),
      ]);

      const committed = t('price.committed', {
        title: isEnglish ? d.catalog.title_en : d.catalog.title_hi,
        price: d.pricing.recommended_wholesale_inr,
      });
      // The server saves the product even if it cannot store the extra photos
      // (before the gallery migration is applied) - say so rather than let the
      // artisan find out when a buyer asks for the other angles.
      void speak(
        product.gallery_saved === false ? `${committed} ${t('price.galleryNotSaved')}` : committed,
        language,
      );
      useCatalogDraftStore.getState().reset();
      // Navigate straight to ONDC, GeM, and WhatsApp B2B syndication hub!
      router.push(`/(tabs)/marketplaces?productId=${product.id}`);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.spokenHi : t('price.commitFailed');
      setError(message);
      void speak(message, language);
    } finally {
      setCommitting(false);
    }
  }, [committing, isEnglish, language, router, t]);

  const hasSize = length > 0 && width > 0;
  const canCommit = Boolean(
    draft.catalog && breakdown && draft.rawImageUrl && material > 0 && hasSize && !calculating,
  );

  // Say *why* the last button is disabled instead of leaving it silently grey.
  const blocker = !draft.rawImageUrl || !draft.catalog
    ? t('price.commitSubBlocked')
    : material <= 0
      ? t('price.costNeeded')
      : !hasSize
        ? t('price.sizeNeeded')
        : null;

  return (
    <ScreenShell bottomInset={40}>
      <View className="flex-row items-center mt-2 mb-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Voice Catalog"
          hitSlop={12}
          onPress={() => router.push('/(tabs)/catalog-voice')}
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
          subject={t('price.title.subject')}
          action={t('price.title.action')}
          size="title"
          subtitle={t('price.subtitle')}
        />
      </View>

      {/* Voice cost entry */}
      <View
        className="mt-6 flex-row items-center rounded-bento p-4"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <View style={{ transform: [{ scale: 0.52 }], marginLeft: -24, marginVertical: -26 }}>
          <VoiceOrbRecorder
            onComplete={(result) => void handleVoiceCost(result)}
            languageCode={language}
            busy={busy}
            label=""
            hint=""
          />
        </View>
        <View className="ml-1 flex-1">
          <Text
            className="font-heading"
            style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
          >
            {t('price.voiceTitle')}
          </Text>
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1, lineHeight: 17 }}
          >
            {t('price.voiceExample')}
          </Text>
        </View>
      </View>

      {/* Cost sliders */}
      <View className="mt-7" style={{ gap: 22 }}>
        <BigSlider
          label={t('price.material')}
          value={draft.materialCostInr}
          min={0}
          max={20000}
          step={50}
          format={(value) => `₹${value.toLocaleString('en-IN')}`}
          onChange={(value) => setCosting({ materialCostInr: value })}
        />
        <BigSlider
          label={t('price.labour')}
          value={draft.laborHours}
          min={0}
          max={200}
          step={0.5}
          format={(value) => `${value} ${t('common.hours')}`}
          onChange={(value) => setCosting({ laborHours: value })}
        />
      </View>

      {/* Dimensions */}
      <View className="mt-7">
        <Text
          className="mb-3 font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
        >
          {t('price.dimensions')}
        </Text>
        <View className="flex-row" style={{ gap: spacing.cardGap }}>
          <DimensionStepper
            label={t('price.length')}
            value={draft.dimensionsCm.length}
            onChange={(length) => setCosting({ dimensionsCm: { length } })}
          />
          <DimensionStepper
            label={t('price.width')}
            value={draft.dimensionsCm.width}
            onChange={(width) => setCosting({ dimensionsCm: { width } })}
          />
          <DimensionStepper
            label={t('price.height')}
            value={draft.dimensionsCm.height}
            onChange={(height) => setCosting({ dimensionsCm: { height } })}
          />
        </View>
      </View>

      {/* How many pieces: it used to be hard-coded to 1, which made every new
          product show as "low stock" the moment it was saved. */}
      <View
        className="mt-5 flex-row items-center rounded-bento p-4"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <Text
          className="flex-1 font-heading"
          style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
        >
          {t('price.quantity')}
        </Text>
        <View className="flex-row items-center" style={{ gap: 14 }}>
          <StepButton
            label="Decrease quantity"
            icon="remove"
            onPress={() => setStockQuantity(draft.stockQuantity - 1)}
          />
          <Text
            className="font-display"
            style={{ color: colors.electricLime, fontSize: typography.title - 2, minWidth: 34, textAlign: 'center' }}
          >
            {draft.stockQuantity}
          </Text>
          <StepButton
            label="Increase quantity"
            icon="add"
            onPress={() => setStockQuantity(draft.stockQuantity + 1)}
          />
        </View>
      </View>

      {/* Pricing comparison bento */}
      {breakdown ? (
        <>
          <View className="mt-8 flex-row" style={{ gap: spacing.cardGap }}>
            {/* Wholesale B2B tier - dark charcoal with lime accents */}
            <View
              className="flex-1 p-5"
              style={{
                borderRadius: radii.bento,
                backgroundColor: colors.surfaceCharcoal,
                borderWidth: 1,
                borderColor: colors.borderHairline,
              }}
            >
              <Text
                className="font-heading"
                style={{ color: colors.electricLime, fontSize: typography.label, letterSpacing: 1 }}
              >
                {t('price.wholesale')}
              </Text>
              <Text
                className="mt-3 font-display"
                style={{ color: colors.textPureWhite, fontSize: typography.title }}
              >
                ₹{breakdown.recommended_wholesale_inr.toLocaleString('en-IN')}
              </Text>
              <Text
                className="mt-1 font-body"
                style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
              >
                {t('price.perPiece')}
              </Text>
              <View
                style={{ height: 1, backgroundColor: colors.borderHairline, marginVertical: 14 }}
              />
              <Text
                className="font-body"
                style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
              >
                {t('price.yourProfit')}
              </Text>
              <Text
                className="font-heading"
                style={{ color: colors.electricLime, fontSize: typography.body + 1 }}
              >
                ₹{Math.round(breakdown.wholesale_profit_inr).toLocaleString('en-IN')}
              </Text>
            </View>

            {/* Retail MRP tier - solid lime gradient with black text */}
            <LinearGradient
              colors={[colors.electricLime, colors.limeGradientEnd]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={{ flex: 1, borderRadius: radii.bento, padding: 20 }}
            >
              <Text
                className="font-heading"
                style={{
                  color: colors.textInverseDark,
                  fontSize: typography.label,
                  letterSpacing: 1,
                  opacity: 0.8,
                }}
              >
                {t('price.retail')}
              </Text>
              <Text
                className="mt-3 font-display"
                style={{ color: colors.textInverseDark, fontSize: typography.title }}
              >
                ₹{breakdown.recommended_retail_inr.toLocaleString('en-IN')}
              </Text>
              <Text
                className="mt-1 font-body"
                style={{ color: 'rgba(8, 10, 6, 0.68)', fontSize: typography.label - 1 }}
              >
                {t('price.directToCustomer')}
              </Text>
              <View
                style={{
                  height: 1,
                  backgroundColor: 'rgba(8, 10, 6, 0.2)',
                  marginVertical: 14,
                }}
              />
              <Text
                className="font-body"
                style={{ color: 'rgba(8, 10, 6, 0.68)', fontSize: typography.label - 1 }}
              >
                {t('price.yourProfit')}
              </Text>
              <Text
                className="font-heading"
                style={{ color: colors.textInverseDark, fontSize: typography.body + 1 }}
              >
                ₹{Math.round(breakdown.retail_profit_inr).toLocaleString('en-IN')}
              </Text>
            </LinearGradient>
          </View>

          {/* Cost breakdown + competitor band */}
          <View
            className="mt-5 rounded-bento p-5"
            style={{
              backgroundColor: colors.surfaceElevated,
              borderWidth: 1,
              borderColor: colors.borderHairline,
            }}
          >
            <View className="flex-row items-center justify-between">
              <Text
                className="font-heading"
                style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1 }}
              >
                {t('price.breakdown')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Listen to the price explanation in Hindi"
                onPress={speakRationale}
                hitSlop={10}
                className="flex-row items-center"
              >
                <Ionicons name="volume-high" size={16} color={colors.electricLime} />
                <Text
                  className="ml-1.5 font-heading"
                  style={{ color: colors.electricLime, fontSize: typography.label }}
                >
                  {t('price.listen')}
                </Text>
              </Pressable>
            </View>

            <View className="mt-4" style={{ gap: 8 }}>
              <BreakdownRow label={t('price.rowMaterial')} value={breakdown.material_cost_inr} />
              <BreakdownRow
                label={t('price.rowLabour', {
                  rate: Math.round(breakdown.skill_rate_inr_per_hour),
                })}
                value={breakdown.labor_cost_inr}
              />
              <BreakdownRow label={t('price.rowPackaging')} value={breakdown.packaging_cost_inr} />
              <View style={{ height: 1, backgroundColor: colors.borderHairline, marginVertical: 4 }} />
              <BreakdownRow label={t('price.rowTotal')} value={breakdown.base_cost_inr} emphasize />
            </View>

            <Text
              className="mt-4 font-body"
              style={{ color: colors.textMutedSage, fontSize: typography.label - 1, lineHeight: 18 }}
            >
              {t('price.competitorBand', {
                low: breakdown.competitor_band_inr.low.toLocaleString('en-IN'),
                high: breakdown.competitor_band_inr.high.toLocaleString('en-IN'),
                ai: breakdown.source === 'ai-benchmarked' ? ' (AI benchmarked)' : '',
              })}
            </Text>
          </View>
        </>
      ) : (
        <View
          className="mt-8 items-center rounded-bento p-7"
          style={{
            backgroundColor: colors.surfaceCharcoal,
            borderWidth: 1,
            borderColor: colors.borderHairline,
          }}
        >
          <Ionicons name="calculator-outline" size={28} color={colors.textMutedSage} />
          <Text
            className="mt-3 text-center font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label }}
          >
            {t('price.emptyHint')}
          </Text>
        </View>
      )}

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-5 font-body"
          style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}
        >
          {error}
        </Text>
      ) : null}

      {/* Commit */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save product and syndicate to ONDC, GeM, WA B2B"
        disabled={!canCommit || committing || calculating}
        onPress={() => void commit()}
        className="mt-7 flex-row items-center rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1.5,
          borderColor: canCommit ? colors.electricLime : colors.borderHairline,
          opacity: canCommit ? 1 : 0.7,
        }}
      >
        <View className="flex-1 pr-4">
          <Text
            className="font-heading"
            style={{ color: colors.textPureWhite, fontSize: typography.body }}
          >
            {canCommit ? `${t('price.commitTitle')} · ONDC / GeM / B2B` : t('price.commitTitleBlocked')}
          </Text>
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label }}
          >
            {committing
              ? 'Saving & preparing syndication...'
              : canCommit
                ? 'Save & proceed to ONDC, GeM & WhatsApp B2B'
                : (blocker ?? t('price.commitSubBlocked'))}
          </Text>
        </View>
        <LimeCircleButton
          accessibilityLabel="Save the product to your catalog"
          disabled={!canCommit || committing || calculating}
          onPress={() => void commit()}
        />
      </Pressable>
    </ScreenShell>
  );
}

/* ------------------------------------------------------------------ pieces */

function BreakdownRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text
        className={emphasize ? 'font-heading' : 'font-body'}
        style={{
          color: emphasize ? colors.textPureWhite : colors.textMutedSage,
          fontSize: typography.label + 1,
        }}
      >
        {label}
      </Text>
      <Text
        className={emphasize ? 'font-display' : 'font-heading'}
        style={{
          color: emphasize ? colors.electricLime : colors.textPureWhite,
          fontSize: typography.label + 1,
        }}
      >
        ₹{Math.round(value).toLocaleString('en-IN')}
      </Text>
    </View>
  );
}

/**
 * Oversized slider. The track is 56px tall rather than the platform-standard
 * 20px, because the target user is dragging with a calloused thumb, often
 * outdoors, and a thin track means a mis-set price.
 */
function BigSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const { t } = useT();
  const width = useSharedValue(0);
  const fraction = useSharedValue(max > min ? (value - min) / (max - min) : 0);
  const dragStart = useSharedValue(0);

  // Keep the handle in sync when voice entry changes the value.
  useEffect(() => {
    fraction.value = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  }, [fraction, max, min, value]);

  const emit = useCallback(
    (next: number) => {
      const stepped = Math.round((min + next * (max - min)) / step) * step;
      onChange(Number(stepped.toFixed(2)));
    },
    [max, min, onChange, step],
  );

  const pan = Gesture.Pan()
    .onStart(() => {
      dragStart.value = fraction.value;
    })
    .onUpdate((event) => {
      if (width.value === 0) return;
      fraction.value = clamp(dragStart.value + event.translationX / width.value, 0, 1);
    })
    .onEnd(() => {
      runOnJS(emit)(fraction.value);
    });

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fraction.value * 100}%`,
  }));

  return (
    <View>
      <View className="mb-2 flex-row items-center justify-between">
        <Text
          className="font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 0.6 }}
        >
          {label}
        </Text>
        <Text
          className="font-display"
          style={{ color: colors.electricLime, fontSize: typography.body + 2 }}
        >
          {format(value)}
        </Text>
      </View>

      <GestureDetector gesture={pan}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: format(value) }}
          onLayout={(event) => {
            width.value = event.nativeEvent.layout.width;
          }}
          style={{
            height: 56,
            justifyContent: 'center',
            borderRadius: radii.card,
            backgroundColor: colors.surfaceCharcoal,
            borderWidth: 1,
            borderColor: colors.borderHairline,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={[
              fillStyle,
              {
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                backgroundColor: 'rgba(168, 235, 52, 0.22)',
                borderRightWidth: 3,
                borderRightColor: colors.electricLime,
              },
            ]}
          />
          <Text
            className="px-4 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
          >
            {t('price.drag')}
          </Text>
        </View>
      </GestureDetector>
    </View>
  );
}

function DimensionStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <View
      className="flex-1 items-center p-3"
      style={{
        borderRadius: radii.card,
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: colors.borderHairline,
      }}
    >
      <Text
        className="font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 2 }}
      >
        {label}
      </Text>
      <Text
        className="mt-1 font-display"
        style={{ color: colors.textPureWhite, fontSize: typography.heading }}
      >
        {value || 0}
      </Text>
      <View className="mt-2 flex-row" style={{ gap: 8 }}>
        <StepButton
          label={`Decrease ${label}`}
          icon="remove"
          onPress={() => onChange(Math.max(0, value - 5))}
        />
        <StepButton
          label={`Increase ${label}`}
          icon="add"
          onPress={() => onChange(value + 5)}
        />
      </View>
    </View>
  );
}

function StepButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: 'add' | 'remove';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(168, 235, 52, 0.14)',
      }}
    >
      <Ionicons name={icon} size={16} color={colors.electricLime} />
    </Pressable>
  );
}
