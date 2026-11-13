import { View } from 'react-native';
import { FormField } from '@/components/ui/FormField';
import type { StringKey } from '@/i18n';
import { colors, typography } from '@/theme/tokens';
import type { ProductFormField, ProductFormValues } from '@/services/productForm';

/**
 * The fields of the edit-product form. It holds no state of its own: the screen owns the
 * values and the errors, so it can validate, save and warn about unsaved changes without
 * reaching into this component.
 */

export interface ProductFormProps {
  values: ProductFormValues;
  /** Already translated, keyed by field. */
  errors: Partial<Record<ProductFormField, string>>;
  onChange: (field: ProductFormField, text: string) => void;
  t: (key: StringKey) => string;
  disabled?: boolean;
}

/** A taller box for descriptions; FormField's own style is replaced, so the text colour is restated. */
const MULTILINE = { flex: 1, minHeight: 96, paddingTop: 12, color: colors.textPureWhite, fontSize: typography.body } as const;

export function ProductForm({ values, errors, onChange, t, disabled = false }: ProductFormProps) {
  const text = (field: ProductFormField, label: StringKey, extra: Partial<React.ComponentProps<typeof FormField>> = {}) => (
    <FormField
      label={t(label)}
      value={values[field]}
      error={errors[field]}
      editable={!disabled}
      onChangeText={(next) => onChange(field, next)}
      {...extra}
    />
  );

  return (
    <View style={{ gap: 14 }}>
      {text('titleEn', 'productForm.field.titleEn')}
      {text('titleHi', 'productForm.field.titleHi')}
      {text('descriptionEn', 'productForm.field.descEn', { multiline: true, textAlignVertical: 'top', style: MULTILINE })}
      {text('descriptionHi', 'productForm.field.descHi', { multiline: true, textAlignVertical: 'top', style: MULTILINE })}
      {text('retail', 'productForm.field.retail', { keyboardType: 'decimal-pad' })}
      {text('wholesale', 'productForm.field.wholesale', { keyboardType: 'decimal-pad' })}
      {text('minQty', 'productForm.field.minQty', { keyboardType: 'number-pad' })}
      {text('tags', 'productForm.field.tags', { autoCapitalize: 'none' })}
      {text('hsnCode', 'productForm.field.hsn', { autoCapitalize: 'characters' })}
      {text('length', 'productForm.field.length', { keyboardType: 'decimal-pad' })}
      {text('width', 'productForm.field.width', { keyboardType: 'decimal-pad' })}
      {text('height', 'productForm.field.height', { keyboardType: 'decimal-pad' })}
    </View>
  );
}
