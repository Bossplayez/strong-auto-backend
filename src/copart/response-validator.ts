/**
 * Response shape validator for provider (Copart/IAAI) API responses.
 *
 * Pure functions — no side effects, no I/O, no logging.
 * Used by CopartService to decide whether a provider response
 * is structurally usable before iterating its items.
 */

/** Reason codes returned when the response shape is not usable. */
export type MalformedReason =
  | 'invalid_envelope'
  | 'missing_or_non_array_collection'
  | 'unusable_page_identity';

/** Successful validation result — the caller may iterate `items`. */
export interface ResponseValidationOk {
  ok: true;
  /** The `body.data` array (may be empty — that just means end of results). */
  items: unknown[];
}

/** Failed validation result — caller should treat the page as malformed. */
export interface ResponseValidationErr {
  ok: false;
  reason: MalformedReason;
  /** Human-readable detail for logging / debugging. */
  detail: string;
}

/** Discriminated union returned by `validateProviderResponse`. */
export type ResponseValidation = ResponseValidationOk | ResponseValidationErr;

/**
 * Validate the structural shape of a provider API response body.
 *
 * Three malformed branches:
 *  1. `invalid_envelope`               — body is null/undefined/non-object/array
 *  2. `missing_or_non_array_collection` — `body.data` is absent or not an array
 *  3. `unusable_page_identity`          — data is a non-empty array but every
 *     element is a non-object (so we cannot extract lot numbers)
 *
 * If `body.data` is a non-empty array and at least one element is an object,
 * the validation passes. Items that are non-objects are still returned in the
 * `items` array — the caller is responsible for per-item filtering.
 *
 * @param body - The parsed JSON body returned by `providerFetch`.
 * @returns A `ResponseValidation` discriminated union.
 */
export function validateProviderResponse(body: unknown): ResponseValidation {
  // ── Branch 1: invalid_envelope ──────────────────────────────────
  if (
    body === null ||
    body === undefined ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    return {
      ok: false,
      reason: 'invalid_envelope',
      detail: `Expected a JSON object, received ${body === null ? 'null' : body === undefined ? 'undefined' : Array.isArray(body) ? 'array' : typeof body}`,
    };
  }

  const envelope = body as Record<string, unknown>;

  // ── Branch 2: missing_or_non_array_collection ───────────────────
  if (
    !('data' in envelope) ||
    !Array.isArray(envelope.data)
  ) {
    const dataField = (envelope as any).data;
    return {
      ok: false,
      reason: 'missing_or_non_array_collection',
      detail: `Expected \`data\` to be an array, received ${dataField === undefined ? 'undefined' : dataField === null ? 'null' : Array.isArray(dataField) ? 'array' : typeof dataField}`,
    };
  }

  const items = envelope.data;

  // Empty array is a valid "end of results" signal.
  if (items.length === 0) {
    return { ok: true, items };
  }

  // ── Branch 3: unusable_page_identity ────────────────────────────
  // If EVERY element is a non-object, we can't extract lot numbers.
  const hasAtLeastOneObject = items.some(
    (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
  );

  if (!hasAtLeastOneObject) {
    return {
      ok: false,
      reason: 'unusable_page_identity',
      detail: `All ${items.length} items in \`data\` are non-objects; cannot extract lot identities`,
    };
  }

  return { ok: true, items };
}
