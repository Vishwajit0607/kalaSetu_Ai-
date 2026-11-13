import { changedFields, CRAFT_MAX, NAME_MAX, validateProfile, VILLAGE_MAX } from '../services/profileForm';

const valid = { fullName: 'Asha Verma', craftCategory: 'Pottery', clusterLocation: 'Khurja' };

describe('validateProfile', () => {
  it('accepts a complete profile', () => {
    expect(validateProfile(valid)).toEqual({
      ok: true,
      values: { full_name: 'Asha Verma', craft_category: 'Pottery', cluster_location: 'Khurja' },
    });
  });

  it('trims the ends and collapses repeated spaces', () => {
    const result = validateProfile({ fullName: '  Asha   Verma ', craftCategory: ' Block  printing', clusterLocation: ' ' });
    expect(result).toMatchObject({ ok: true, values: { full_name: 'Asha Verma', craft_category: 'Block printing' } });
  });

  it('turns an emptied village into null, because that is what the server stores', () => {
    expect(validateProfile({ ...valid, clusterLocation: '   ' })).toMatchObject({ ok: true, values: { cluster_location: null } });
  });

  it('requires a name and a craft, but not a village', () => {
    expect(validateProfile({ ...valid, fullName: '  ' })).toEqual({ ok: false, errors: { fullName: 'profileForm.err.name' } });
    expect(validateProfile({ ...valid, craftCategory: '' })).toEqual({ ok: false, errors: { craftCategory: 'profileForm.err.craft' } });
    expect(validateProfile({ ...valid, clusterLocation: '' }).ok).toBe(true);
  });

  it('allows exactly the maximum lengths and rejects one more', () => {
    expect(validateProfile({ fullName: 'a'.repeat(NAME_MAX), craftCategory: 'b'.repeat(CRAFT_MAX), clusterLocation: 'c'.repeat(VILLAGE_MAX) }).ok).toBe(true);
    expect(validateProfile({ ...valid, fullName: 'a'.repeat(NAME_MAX + 1) })).toEqual({ ok: false, errors: { fullName: 'profileForm.err.nameLong' } });
    expect(validateProfile({ ...valid, craftCategory: 'b'.repeat(CRAFT_MAX + 1) })).toEqual({ ok: false, errors: { craftCategory: 'profileForm.err.craftLong' } });
    expect(validateProfile({ ...valid, clusterLocation: 'c'.repeat(VILLAGE_MAX + 1) })).toEqual({ ok: false, errors: { clusterLocation: 'profileForm.err.villageLong' } });
  });

  it('counts length after tidying, so trailing spaces cannot push a valid name over the limit', () => {
    expect(validateProfile({ ...valid, fullName: 'a'.repeat(NAME_MAX) + '    ' }).ok).toBe(true);
  });

  it('reports every problem at once', () => {
    expect(validateProfile({ fullName: '', craftCategory: '', clusterLocation: 'c'.repeat(VILLAGE_MAX + 1) })).toEqual({
      ok: false,
      errors: { fullName: 'profileForm.err.name', craftCategory: 'profileForm.err.craft', clusterLocation: 'profileForm.err.villageLong' },
    });
  });

  it('accepts Hindi text', () => {
    expect(validateProfile({ fullName: 'आशा वर्मा', craftCategory: 'मिट्टी के बर्तन', clusterLocation: 'खुर्जा' }).ok).toBe(true);
  });
});

describe('changedFields', () => {
  const saved = { fullName: 'Asha Verma', craftCategory: 'Pottery', clusterLocation: 'Khurja' as string | null };
  const same = { full_name: 'Asha Verma', craft_category: 'Pottery', cluster_location: 'Khurja' as string | null };

  it('is empty when nothing changed', () => {
    expect(changedFields(saved, same)).toEqual({});
  });

  it('includes only what differs', () => {
    expect(changedFields(saved, { ...same, craft_category: 'Weaving' })).toEqual({ craft_category: 'Weaving' });
    expect(changedFields(saved, { ...same, full_name: 'Asha V.', cluster_location: 'Delhi' })).toEqual({ full_name: 'Asha V.', cluster_location: 'Delhi' });
  });

  it('can clear the village by sending null', () => {
    expect(changedFields(saved, { ...same, cluster_location: null })).toEqual({ cluster_location: null });
  });

  it('does not treat "no village" and "no village" as a change', () => {
    expect(changedFields({ ...saved, clusterLocation: null }, { ...same, cluster_location: null })).toEqual({});
  });
});
