'use client';

import { X } from 'lucide-react';
import type { VehicleFilters } from '@/lib/types';

interface FilterChipsProps {
  filters: VehicleFilters;
  onRemove: (key: keyof VehicleFilters) => void;
  onReset: () => void;
}

const filterLabels: Record<string, (v: unknown) => string> = {
  make: (v) => `${v}`,
  model: (v) => `${v}`,
  yearFrom: (v) => `від ${v} р.`,
  yearTo: (v) => `до ${v} р.`,
  priceFrom: (v) => `від $${Number(v).toLocaleString('uk-UA')}`,
  priceTo: (v) => `до $${Number(v).toLocaleString('uk-UA')}`,
  mileageFrom: (v) => `від ${Number(v).toLocaleString('uk-UA')} км`,
  mileageTo: (v) => `до ${Number(v).toLocaleString('uk-UA')} км`,
  bodyType: (v) => `${v}`,
  fuelType: (v) => `${v}`,
  transmission: (v) => `${v}`,
  driveType: (v) => `${v}`,
  sourceType: (v) => `${v}`,
};

// Keys that should never appear as chips
const ignoredKeys = new Set(['sort', 'page', 'pageSize', 'sourceRegion']);

export function FilterChips({ filters, onRemove, onReset }: FilterChipsProps) {
  const activeFilters = Object.entries(filters).filter(
    ([key, value]) =>
      value !== undefined &&
      value !== '' &&
      value !== null &&
      !ignoredKeys.has(key) &&
      key in filterLabels
  );

  if (activeFilters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3.5">
      {activeFilters.map(([key, value]) => (
        <button
          key={key}
          onClick={() => onRemove(key as keyof VehicleFilters)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-navy-800 rounded-full text-xs font-medium text-white hover:bg-navy-700 transition-colors group"
        >
          {filterLabels[key](value)}
          <X className="h-3 w-3 text-white/60 group-hover:text-white transition-colors" />
        </button>
      ))}
      <button
        onClick={onReset}
        className="text-xs font-semibold text-fg-muted hover:text-red-500 transition-colors px-2 py-1.5"
      >
        Очистити все
      </button>
    </div>
  );
}
