import type { Prisma } from '@prisma/client';

/** Canonical 2026-H1 Ukraine passenger-auction market scope. */
export interface MarketScopeSubject { make?: string | null; model?: string | null; title?: string | null; bodyStyle?: string | null; }
export interface PassengerPartition { make: string; model: string; }

const MODELS: Readonly<Record<string, readonly string[]>> = {
  VOLKSWAGEN: ['GOLF', 'TIGUAN', 'PASSAT'], AUDI: ['Q5', 'A4', 'A6', 'Q7'], NISSAN: ['ROGUE', 'QASHQAI', 'LEAF'],
  SKODA: ['OCTAVIA', 'FABIA'], RENAULT: ['MEGANE', 'ZOE', 'SCENIC'], FORD: ['ESCAPE', 'FOCUS'], TESLA: ['MODEL Y', 'MODEL 3'],
  CHEVROLET: ['BOLT'], BMW: ['3 SERIES', '5 SERIES', 'X3', 'X5'], HYUNDAI: ['KONA', 'TUCSON'], JEEP: ['CHEROKEE'],
  KIA: ['NIRO'], MAZDA: ['CX-5'], OPEL: ['ASTRA'], TOYOTA: ['CAMRY'],
};
const MAKE_ALIASES: Readonly<Record<string, string>> = { VW: 'VOLKSWAGEN' };
const DB_MAKE_ALIASES: Readonly<Record<string, readonly string[]>> = { VOLKSWAGEN: ['VOLKSWAGEN', 'VW'] };
const NON_PASSENGER = /\b(?:pickup|truck|cargo|commercial|box\s*truck|van|bus|motorcycle|motorbike|atv|utv|trailer|rv|motorhome|tractor|forklift|excavator|bulldozer|generator|equipment|machinery|tool|lawn\s*mower|snowmobile|golf\s*cart)\b/i;
const key = (value: string | null | undefined) => (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export const normalizeMarketMake = (value: string | null | undefined) => MAKE_ALIASES[key(value)] ?? key(value);
export const normalizeMarketModel = (value: string | null | undefined) => key(value);
export const PASSENGER_DISCOVERY_PARTITIONS: readonly PassengerPartition[] = Object.entries(MODELS).flatMap(([make, models]) => models.map((model) => ({ make, model }))).sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
export const isExplicitNonPassenger = (subject: MarketScopeSubject) => NON_PASSENGER.test([subject.title, subject.bodyStyle].filter(Boolean).join(' '));

function matchesConfiguredModel(make: string, candidate: string, configured: string): boolean {
  if (candidate === configured || candidate.startsWith(`${configured} `)) return true;
  if (make === 'BMW' && configured === '3 SERIES') return /^3\d{2}(?:$|\s|[A-Z])/.test(candidate);
  if (make === 'BMW' && configured === '5 SERIES') return /^5\d{2}(?:$|\s|[A-Z])/.test(candidate);
  return false;
}

export const isPassengerMarketScope = (subject: MarketScopeSubject) => {
  const make = normalizeMarketMake(subject.make);
  const candidate = normalizeMarketModel(subject.model);
  return (MODELS[make] ?? []).some((model) => matchesConfiguredModel(make, candidate, key(model)));
};

function modelWhere(make: string, model: string): Prisma.DiscoveredLotWhereInput {
  if (make === 'BMW' && model === '3 SERIES') return { model: { startsWith: '3', mode: 'insensitive' } };
  if (make === 'BMW' && model === '5 SERIES') return { model: { startsWith: '5', mode: 'insensitive' } };
  return { model: { startsWith: model, mode: 'insensitive' } };
}

/** Database form of the same market policy used by list, count and filters. */
export function passengerMarketScopeWhere(): Prisma.DiscoveredLotWhereInput {
  return {
    OR: Object.entries(MODELS).map(([make, models]) => ({
      AND: [
        {
          OR: (DB_MAKE_ALIASES[make] ?? [make]).map((alias) => ({
            make: { equals: alias, mode: 'insensitive' as const },
          })),
        },
        { OR: models.map((model) => modelWhere(make, model)) },
      ],
    })),
  };
}

/** Existing rows are preserved; this decides whether a new row may be created. */
export const acceptsNewPassengerLot = (subject: MarketScopeSubject) => !isExplicitNonPassenger(subject) && isPassengerMarketScope(subject);
