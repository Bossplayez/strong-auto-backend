import { validateProviderResponse, type ResponseValidation } from './response-validator';

describe('validateProviderResponse', () => {
  // ── Valid responses ──

  it('accepts a valid response with non-empty data array', () => {
    const body = { data: [{ lot_number: 123 }, { lot_number: 456 }] };
    const result = validateProviderResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items).toHaveLength(2);
  });

  it('accepts an empty data array (end of results)', () => {
    const body = { data: [] };
    const result = validateProviderResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items).toHaveLength(0);
  });

  it('accepts data with mix of objects and non-objects (at least one object)', () => {
    const body = { data: [{ lot_number: 1 }, 'stray', null, 42] };
    const result = validateProviderResponse(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items).toHaveLength(4);
  });

  // ── Branch 1: invalid_envelope ──

  it('rejects null body as invalid_envelope', () => {
    const result = validateProviderResponse(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_envelope');
      expect(result.detail).toContain('null');
    }
  });

  it('rejects undefined body as invalid_envelope', () => {
    const result = validateProviderResponse(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_envelope');
      expect(result.detail).toContain('undefined');
    }
  });

  it('rejects array body as invalid_envelope', () => {
    const result = validateProviderResponse([1, 2, 3]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_envelope');
      expect(result.detail).toContain('array');
    }
  });

  it('rejects string body as invalid_envelope', () => {
    const result = validateProviderResponse('hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_envelope');
  });

  it('rejects number body as invalid_envelope', () => {
    const result = validateProviderResponse(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_envelope');
  });

  // ── Branch 2: missing_or_non_array_collection ──

  it('rejects missing data field as missing_or_non_array_collection', () => {
    const result = validateProviderResponse({ meta: 'info' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_or_non_array_collection');
      expect(result.detail).toContain('undefined');
    }
  });

  it('rejects null data as missing_or_non_array_collection', () => {
    const result = validateProviderResponse({ data: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_or_non_array_collection');
      expect(result.detail).toContain('null');
    }
  });

  it('rejects object data as missing_or_non_array_collection', () => {
    const result = validateProviderResponse({ data: { lot: 1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_or_non_array_collection');
  });

  it('rejects string data as missing_or_non_array_collection', () => {
    const result = validateProviderResponse({ data: 'not-an-array' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_or_non_array_collection');
  });

  // ── Branch 3: unusable_page_identity ──

  it('rejects all-non-object array as unusable_page_identity', () => {
    const result = validateProviderResponse({ data: ['str', 42, null, true] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unusable_page_identity');
      expect(result.detail).toContain('4');
    }
  });

  it('rejects all-null array as unusable_page_identity', () => {
    const result = validateProviderResponse({ data: [null, null, null] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unusable_page_identity');
  });

  // ── Sanitization ──

  it('does not leak response body content into reason/detail', () => {
    const body = { data: [{ secret: 'SENSITIVE_API_KEY_123', password: 'leaked' }] };
    const result = validateProviderResponse(body);
    // Valid response — just verify no secret leakage in any path
    expect(result.ok).toBe(true);

    const badBody = { notData: 'SENSITIVE_BODY_CONTENT' };
    const badResult = validateProviderResponse(badBody);
    if (!badResult.ok) {
      expect(badResult.detail).not.toContain('SENSITIVE_BODY_CONTENT');
    }
  });
});
