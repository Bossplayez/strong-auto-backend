import { BadRequestException } from '@nestjs/common';
import type { DiscoveredLot, Vehicle } from '@prisma/client';

export const CONTRACT_VERSION = 'unified-auction-rc-v1' as const;
export const PROVIDERS = ['copart', 'iaai'] as const;
export const LIFECYCLES = ['UPCOMING', 'OPEN', 'LIVE', 'ENDED', 'SOLD', 'REMOVED', 'NOT_READY'] as const;
export const FRESHNESSES = ['FRESH', 'STALE', 'DEFERRED'] as const;
export const SORTS = ['newest_desc', 'year_asc', 'year_desc', 'price_asc', 'price_desc', 'mileage_asc', 'mileage_desc', 'auction_asc', 'auction_desc'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type InventoryView = 'all' | 'usa' | 'curated';

export interface InventoryQuery {
  view: InventoryView;
  page: number;
  pageSize: number;
  q?: string;
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  priceFrom?: number;
  priceTo?: number;
  mileageFrom?: number;
  mileageTo?: number;
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  driveType?: string;
  source?: 'internal' | Provider;
  provider?: Provider;
  locationState?: string;
  lifecycle?: (typeof LIFECYCLES)[number];
  buyNow?: boolean;
  sort: (typeof SORTS)[number];
}

const PUBLIC_QUERY_KEYS = new Set([
  'view', 'page', 'pageSize', 'q', 'make', 'model', 'yearFrom', 'yearTo',
  'priceFrom', 'priceTo', 'mileageFrom', 'mileageTo', 'bodyType', 'fuelType',
  'transmission', 'driveType', 'source', 'provider', 'locationState',
  'lifecycle', 'buyNow', 'sort',
]);

export function validationError(message = 'Request validation failed.'): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message });
}

export function unsupportedViewFilter(message: string): never {
  throw new BadRequestException({ code: 'UNSUPPORTED_FILTER_FOR_VIEW', message });
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') validationError();
  const text = value.trim();
  return text || undefined;
}

function optionalInteger(value: unknown, minimum?: number, maximum?: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && !/^-?\d+$/.test(value)) validationError();
  const number = Number(value);
  if (!Number.isInteger(number) || (minimum !== undefined && number < minimum) || (maximum !== undefined && number > maximum)) validationError();
  return number;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) validationError();
  return number;
}

export function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  validationError('Boolean values must be true or false.');
}

export function parseInventoryQuery(raw: Record<string, unknown>, forcedView?: InventoryView, allowPaginationAndSort = true): InventoryQuery {
  for (const key of Object.keys(raw)) if (!PUBLIC_QUERY_KEYS.has(key)) validationError(`Unknown query field: ${key}`);
  if (!allowPaginationAndSort && (raw.page !== undefined || raw.pageSize !== undefined || raw.sort !== undefined)) validationError();
  const requestedView = forcedView ?? optionalText(raw.view) ?? 'all';
  if (!['all', 'usa', 'curated'].includes(requestedView)) validationError();
  if (forcedView && raw.view !== undefined && raw.view !== forcedView) validationError();
  const view = requestedView as InventoryView;
  const page = optionalInteger(raw.page, 1) ?? 1;
  const pageSize = optionalInteger(raw.pageSize, 1, 50) ?? 20;
  const source = optionalText(raw.source);
  const provider = optionalText(raw.provider);
  const lifecycle = optionalText(raw.lifecycle);
  const sort = optionalText(raw.sort) ?? (view === 'usa' ? 'auction_asc' : 'newest_desc');
  if (source && !['internal', ...PROVIDERS].includes(source as Provider)) validationError();
  if (provider && !PROVIDERS.includes(provider as Provider)) validationError();
  if (lifecycle && !LIFECYCLES.includes(lifecycle as (typeof LIFECYCLES)[number])) validationError();
  if (!SORTS.includes(sort as (typeof SORTS)[number])) validationError();
  if (view === 'curated' && (provider || lifecycle || raw.buyNow !== undefined || sort.startsWith('auction_'))) unsupportedViewFilter('Auction-only filters are unsupported for curated inventory.');
  if (sort.startsWith('auction_') && view === 'curated') unsupportedViewFilter('Auction sort is unsupported for curated inventory.');
  const yearFrom = optionalInteger(raw.yearFrom);
  const yearTo = optionalInteger(raw.yearTo);
  const priceFrom = optionalNumber(raw.priceFrom);
  const priceTo = optionalNumber(raw.priceTo);
  const mileageFrom = optionalNumber(raw.mileageFrom);
  const mileageTo = optionalNumber(raw.mileageTo);
  if ((yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) ||
      (priceFrom !== undefined && priceTo !== undefined && priceFrom > priceTo) ||
      (mileageFrom !== undefined && mileageTo !== undefined && mileageFrom > mileageTo)) validationError('Range minimum cannot exceed maximum.');
  return {
    view, page, pageSize, q: optionalText(raw.q), make: optionalText(raw.make), model: optionalText(raw.model),
    yearFrom, yearTo, priceFrom, priceTo, mileageFrom, mileageTo,
    bodyType: optionalText(raw.bodyType), fuelType: optionalText(raw.fuelType), transmission: optionalText(raw.transmission), driveType: optionalText(raw.driveType),
    source: source as InventoryQuery['source'], provider: provider as Provider | undefined, locationState: optionalText(raw.locationState),
    lifecycle: lifecycle as InventoryQuery['lifecycle'], buyNow: optionalBoolean(raw.buyNow), sort: sort as InventoryQuery['sort'],
  };
}

export const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
const nullable = (value: string | null | undefined) => value || null;

export function eligibleLot(lot: Pick<DiscoveredLot, 'lifecycleState' | 'freshnessState' | 'availabilityConfirmed' | 'consecutiveMisses'>): boolean {
  // Terminal lifecycles never appear in public catalog
  if (['ENDED', 'SOLD', 'REMOVED'].includes(lot.lifecycleState)) return false;
  if (lot.lifecycleState === 'NOT_READY') return false;
  return lot.availabilityConfirmed && lot.consecutiveMisses < 3 &&
    ['UPCOMING', 'OPEN', 'LIVE'].includes(lot.lifecycleState) && lot.freshnessState === 'FRESH';
}

export function timezoneOffset(minutes: number | null): string | null {
  if (minutes === null) return null;
  const absolute = Math.abs(minutes);
  return `${minutes >= 0 ? '+' : '-'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

export function priceFact(lot: Pick<DiscoveredLot, 'buyNowUsd' | 'currentBidUsd' | 'isBuyNow'>) {
  const buyNowUsd = positive(lot.buyNowUsd);
  const currentBidUsd = positive(lot.currentBidUsd);
  return {
    currency: 'USD' as const,
    primaryUsd: buyNowUsd ?? currentBidUsd,
    basis: buyNowUsd ? 'buyNow' as const : currentBidUsd ? 'currentBid' as const : null,
    currentBidUsd,
    buyNowUsd,
    buyNowAvailable: lot.isBuyNow ? (buyNowUsd ? true : null) : false,
  };
}

export function auctionItem(lot: DiscoveredLot) {
  return {
    key: `auctionLot:${lot.provider}:${lot.externalLotId}`, kind: 'auctionLot' as const, source: lot.provider as Provider,
    title: lot.title, make: nullable(lot.make), model: nullable(lot.model), year: lot.year,
    bodyType: nullable(lot.bodyStyle), fuelType: nullable(lot.fuelType), transmission: nullable(lot.transmission), driveType: nullable(lot.driveType),
    locationState: nullable(lot.locationState), odometerKm: lot.odometerKm ?? (lot.odometerMi === null ? null : Math.round(lot.odometerMi * 1.609344)),
    thumbnailUrl: lot.mediaUrls[0] ?? null, mediaCount: lot.mediaUrls.length,
    price: priceFact(lot), provider: lot.provider as Provider, externalLotId: lot.externalLotId, importedVehicleId: lot.vehicleId ?? null,
    lifecycle: lot.lifecycleState, freshness: lot.freshnessState === 'TERMINAL' ? 'DEFERRED' as const : lot.freshnessState,
    auctionAt: iso(lot.auctionTime), providerTimezoneOffset: timezoneOffset(lot.auctionTimezoneOffset),
  };
}

export function vehicleItem(vehicle: Vehicle & { media?: { sourceUrl: string | null }[] }) {
  const price = positive(vehicle.priceAmount);
  const source = vehicle.sourceType === 'COPART' ? 'copart' : vehicle.sourceType === 'IAAI' ? 'iaai' : 'internal';
  const media = (vehicle.media ?? []).map((item) => item.sourceUrl).filter((url): url is string => Boolean(url));
  return {
    key: `vehicle:${vehicle.id}`, kind: 'vehicle' as const, source, title: vehicle.title, make: nullable(vehicle.make), model: nullable(vehicle.model), year: vehicle.year,
    bodyType: nullable(vehicle.bodyType), fuelType: nullable(vehicle.fuelType), transmission: nullable(vehicle.transmission), driveType: nullable(vehicle.driveType), locationState: nullable(vehicle.locationState), odometerKm: vehicle.odometerValue ?? null,
    thumbnailUrl: media[0] ?? null, mediaCount: media.length,
    price: { currency: 'USD' as const, primaryUsd: price, basis: price ? 'vehiclePrice' as const : null, currentBidUsd: null, buyNowUsd: null, buyNowAvailable: null },
    vehicleId: vehicle.id, slug: vehicle.slug, publicationStatus: 'PUBLISHED' as const, provider: null, externalLotId: null, importedVehicleId: null, lifecycle: null, freshness: null, auctionAt: null, providerTimezoneOffset: null,
  };
}

export type CatalogItem = ReturnType<typeof auctionItem> | ReturnType<typeof vehicleItem>;

const exact = (value: unknown, expected: string | undefined) => expected === undefined || String(value ?? '').toLocaleLowerCase() === expected.toLocaleLowerCase();
export function filterItems(items: CatalogItem[], query: InventoryQuery, excludedDimension?: keyof InventoryQuery): CatalogItem[] {
  return items.filter((item) => {
    if (query.view === 'usa' && item.kind !== 'auctionLot') return false;
    if (query.view === 'curated' && item.kind !== 'vehicle') return false;
    if ((query.provider || query.lifecycle || query.buyNow !== undefined) && item.kind !== 'auctionLot') return false;
    const qValues = [item.title, item.make, item.model, item.kind === 'vehicle' ? item.slug : item.externalLotId];
    if (excludedDimension !== 'q' && query.q && !qValues.some((value) => String(value ?? '').toLocaleLowerCase().includes(query.q!.toLocaleLowerCase()))) return false;
    const dimensions: Array<[keyof InventoryQuery, unknown, string | undefined]> = [
      ['make', item.make, query.make], ['model', item.model, query.model], ['bodyType', item.bodyType, query.bodyType], ['fuelType', item.fuelType, query.fuelType],
      ['transmission', item.transmission, query.transmission], ['driveType', item.driveType, query.driveType], ['source', item.source, query.source],
      ['provider', item.provider, query.provider], ['locationState', item.locationState, query.locationState], ['lifecycle', item.lifecycle, query.lifecycle],
    ];
    if (dimensions.some(([dimension, value, expected]) => dimension !== excludedDimension && !exact(value, expected))) return false;
    if (excludedDimension !== 'buyNow' && query.buyNow !== undefined && (item.kind !== 'auctionLot' || item.price.buyNowAvailable !== query.buyNow)) return false;
    const numeric: Array<[keyof InventoryQuery, number | null, number | undefined, (value: number, bound: number) => boolean]> = [
      ['yearFrom', item.year, query.yearFrom, (value, bound) => value >= bound], ['yearTo', item.year, query.yearTo, (value, bound) => value <= bound],
      ['priceFrom', item.price.primaryUsd, query.priceFrom, (value, bound) => value >= bound], ['priceTo', item.price.primaryUsd, query.priceTo, (value, bound) => value <= bound],
      ['mileageFrom', item.odometerKm, query.mileageFrom, (value, bound) => value >= bound], ['mileageTo', item.odometerKm, query.mileageTo, (value, bound) => value <= bound],
    ];
    return numeric.every(([dimension, value, bound, compare]) => dimension === excludedDimension || bound === undefined || (value !== null && compare(value, bound)));
  });
}

export function sortItems(items: CatalogItem[], sort: InventoryQuery['sort'], newestAt: Map<string, Date>): CatalogItem[] {
  const direction = sort.endsWith('_desc') ? -1 : 1;
  const value = (item: CatalogItem): string | number | null => {
    if (sort.startsWith('year')) return item.year;
    if (sort.startsWith('price')) return item.price.primaryUsd;
    if (sort.startsWith('mileage')) return item.odometerKm;
    if (sort.startsWith('auction')) return item.auctionAt;
    return newestAt.get(item.key)?.toISOString() ?? null;
  };
  return [...items].sort((left, right) => {
    const a = value(left); const b = value(right);
    if (a === null) return b === null ? left.key.localeCompare(right.key) : 1;
    if (b === null) return -1;
    if (a < b) return -1 * direction;
    if (a > b) return direction;
    return left.key.localeCompare(right.key);
  });
}

export function page<T>(items: T[], total: number, pageNumber: number, pageSize: number, asOf = new Date()) {
  return { contractVersion: CONTRACT_VERSION, items, total, page: pageNumber, pageSize, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize), hasNext: pageNumber * pageSize < total, hasPrevious: pageNumber > 1, asOf: asOf.toISOString() };
}
