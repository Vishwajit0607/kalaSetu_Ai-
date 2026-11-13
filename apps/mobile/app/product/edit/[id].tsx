import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { ProductForm } from '@/components/ui/ProductForm';
import { colors, radii, typography } from '@/theme/tokens';
import { api, ApiError } from '@/services/apiClient';
import {
  FORM_FIELDS,
  changedProductFields,
  validateProductForm,
  valuesFromProduct,
  type ProductFormField,
  type ProductFormValues,
} from '@/services/productForm';
import { speak } from '@/services/speech';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * Edit product: title, description, prices, minimum quantity, tags, HSN and size.
 *
 * What it will NOT change, on purpose: stock (the Inventory tab records every stock change),
 * the SKU and the owner. Only fields that changed are sent, and a product that is not the
 * signed-in artisan's comes back from the server as a 404, shown as "not found".
 *
 * Leaving with unsaved changes asks first, on the screen's back arrow and on Android's back
 * button, so a half-typed price is never thrown away by a stray swipe.
 */
export default function EditProductScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useT();
  const serverId = useArtisanStore((state) => state.profile?.serverId);

  const productKey = ['product', serverId, id] as const;
  const productQuery = useQuery({
    queryKey: productKey,
    queryFn: async () => (await api.getProduct(id)).product,
    enabled: Boolean(id) && Boolean(serverId),
    // A 404 will not change by asking again; anything else (offline, a blip) gets two more tries.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const product = productQuery.data;

  const [values, setValues] = useState<ProductFormValues | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What the boxes started as, to tell whether the artisan has changed anything.
  const initial = useRef<ProductFormValues | null>(null);

  // Fill the boxes once, when the product first arrives - a later refetch must not wipe what is being typed.
  useEffect(() => {
    if (product && values === null) {
      const start = valuesFromProduct(product);
      initial.current = start;
      setValues(start);
    }
  }, [product, values]);

  const dirty = Boolean(values && initial.current && FORM_FIELDS.some((field) => values[field] !== initial.current![field]));

  const confirmLeave = (): void => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(t('editProduct.discard.title'), t('editProduct.discard.body'), [
      { text: t('editProduct.discard.keep'), style: 'cancel' },
      { text: t('editProduct.discard.leave'), style: 'destructive', onPress: () => router.back() },
    ]);
  };

  useEffect(() => {
    if (!dirty) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmLeave();
      return true; // we handled it
    });
    return () => subscription.remove();
    // confirmLeave only reads `dirty`, `t` and `router`, all of which are in this list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, t, router]);

  const change = (field: ProductFormField, text: string): void => {
    setValues((current) => (current ? { ...current, [field]: text } : current));
    setErrors((current) => {
      if (!current[field]) return current;
      const { [field]: _fixed, ...rest } = current;
      return rest;
    });
    setBanner(null);
  };

  const save = async (): Promise<void> => {
    if (busy || !product || !values) return;
    setBanner(null);

    const check = validateProductForm(values);
    if (!check.ok) {
      setErrors(Object.fromEntries(Object.entries(check.errors).map(([field, key]) => [field, t(key)])));
      const message = t('editProduct.fixFields');
      setBanner(message);
      void speak(message, lang);
      return;
    }
    setErrors({});

    const patch = changedProductFields(product, check.values);
    if (Object.keys(patch).length === 0) {
      setBanner(t('editProduct.nothingChanged'));
      return;
    }

    setBusy(true);
    try {
      const { product: saved } = await api.updateProduct(product.id, patch);
      queryClient.setQueryData(productKey, saved);
      // The inventory list is what the product screen and the bazaar read from.
      void queryClient.invalidateQueries({ queryKey: ['inventory', serverId] });
      void queryClient.invalidateQueries({ queryKey: ['bazaar'] });
      void queryClient.invalidateQueries({ queryKey: ['price-history', serverId, id] });
      void speak(t('editProduct.saved'), lang);
      // Leave without the "unsaved changes" question: everything is saved.
      initial.current = values;
      router.back();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.spokenHi : t('editProduct.failed');
      setBanner(message);
      void speak(message, lang);
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <View className="mt-2 flex-row items-center">
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={confirmLeave} hitSlop={12}>
        <Ionicons name="chevron-back" size={26} color={colors.textPureWhite} />
      </Pressable>
    </View>
  );

  if (productQuery.isLoading || (product && values === null)) {
    return (
      <ScreenShell scroll={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.electricLime} />
        </View>
      </ScreenShell>
    );
  }

  if (!product || !values) {
    const missing = productQuery.error instanceof ApiError && productQuery.error.status === 404;
    return (
      <ScreenShell>
        {back}
        <View style={{ marginTop: 16 }}>
          <SplitHeading
            subject={t('product.notFound.subject')}
            action={t('product.notFound.action')}
            size="title"
            subtitle={missing ? t('product.notFound.sub') : t('editProduct.loadFailed')}
          />
        </View>
        {missing ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('editProduct.retry')}
            onPress={() => void productQuery.refetch()}
            className="mt-6 items-center justify-center"
            style={{ minHeight: 56, borderRadius: radii.pill, backgroundColor: colors.electricLime }}
          >
            <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.body }}>
              {t('editProduct.retry')}
            </Text>
          </Pressable>
        )}
      </ScreenShell>
    );
  }

  return (
    <ScreenShell bottomInset={40}>
      {back}

      <View style={{ marginTop: 8 }}>
        <SplitHeading
          subject={t('editProduct.title.subject')}
          action={t('editProduct.title.action')}
          size="title"
          subtitle={product.sku}
        />
      </View>

      <View className="mt-6">
        <ProductForm values={values} errors={errors} onChange={change} t={t} disabled={busy} />
      </View>

      <Text className="mt-4 font-body" style={{ color: colors.textMutedSage, fontSize: typography.label - 1, lineHeight: 17 }}>
        {t('editProduct.stockNote')}
      </Text>

      {banner ? (
        <Text accessibilityRole="alert" className="mt-4 font-body" style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}>
          {banner}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('editProduct.save')}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void save()}
        className="mt-7 items-center justify-center"
        style={{ minHeight: 56, borderRadius: radii.pill, backgroundColor: colors.electricLime, opacity: busy ? 0.7 : 1 }}
      >
        {busy ? (
          <ActivityIndicator color={colors.textInverseDark} />
        ) : (
          <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.body }}>
            {t('editProduct.save')}
          </Text>
        )}
      </Pressable>
    </ScreenShell>
  );
}
