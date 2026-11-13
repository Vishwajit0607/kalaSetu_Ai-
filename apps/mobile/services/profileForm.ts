import type { StringKey } from '@/i18n';

/**
 * The edit-profile form, as pure functions.
 *
 * Limits mirror the server's schema for `PATCH /v1/me` (name 1-120, craft 1-80,
 * village up to 120). Only fields that actually changed are sent: a PATCH that
 * carries unchanged values still rewrites them, and "nothing changed" is a state
 * the screen should show rather than a pointless request.
 */

export const NAME_MAX = 120;
export const CRAFT_MAX = 80;
export const VILLAGE_MAX = 120;

export interface ProfileValues {
  fullName: string;
  craftCategory: string;
  clusterLocation: string;
}

export type ProfileFieldError =
  | 'profileForm.err.name'
  | 'profileForm.err.nameLong'
  | 'profileForm.err.craft'
  | 'profileForm.err.craftLong'
  | 'profileForm.err.villageLong';

export type ProfileValidation =
  | { ok: true; values: { full_name: string; craft_category: string; cluster_location: string | null } }
  | { ok: false; errors: Partial<Record<'fullName' | 'craftCategory' | 'clusterLocation', ProfileFieldError & StringKey>> };

/** Tidy what was typed: trim ends and collapse runs of spaces. */
const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

export function validateProfile(input: ProfileValues): ProfileValidation {
  const fullName = tidy(input.fullName);
  const craft = tidy(input.craftCategory);
  const village = tidy(input.clusterLocation);
  const errors: Partial<Record<'fullName' | 'craftCategory' | 'clusterLocation', ProfileFieldError>> = {};

  if (fullName.length === 0) errors.fullName = 'profileForm.err.name';
  else if (fullName.length > NAME_MAX) errors.fullName = 'profileForm.err.nameLong';

  if (craft.length === 0) errors.craftCategory = 'profileForm.err.craft';
  else if (craft.length > CRAFT_MAX) errors.craftCategory = 'profileForm.err.craftLong';

  if (village.length > VILLAGE_MAX) errors.clusterLocation = 'profileForm.err.villageLong';

  if (Object.keys(errors).length > 0) return { ok: false, errors: errors as never };

  return {
    ok: true,
    // An emptied village is null on the server, not an empty string.
    values: { full_name: fullName, craft_category: craft, cluster_location: village.length > 0 ? village : null },
  };
}

export interface ProfilePatch {
  full_name?: string;
  craft_category?: string;
  cluster_location?: string | null;
}

/** Only the fields whose value differs from what is saved. Empty means nothing to do. */
export function changedFields(
  saved: { fullName: string; craftCategory: string; clusterLocation: string | null },
  next: { full_name: string; craft_category: string; cluster_location: string | null },
): ProfilePatch {
  const patch: ProfilePatch = {};
  if (next.full_name !== saved.fullName) patch.full_name = next.full_name;
  if (next.craft_category !== saved.craftCategory) patch.craft_category = next.craft_category;
  if (next.cluster_location !== saved.clusterLocation) patch.cluster_location = next.cluster_location;
  return patch;
}
