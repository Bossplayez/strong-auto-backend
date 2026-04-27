'use client';

import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { VehicleFilters as VehicleFiltersType, FilterOptions } from '@/lib/types';

interface VehicleFiltersProps {
  filters: VehicleFiltersType;
  onFilterChange: (filters: VehicleFiltersType) => void;
  filterOptions: FilterOptions;
}

const sortOptions = [
  { value: 'createdAt_desc', label: 'Найновіші' },
  { value: 'price_asc', label: 'Ціна: від низької' },
  { value: 'price_desc', label: 'Ціна: від високої' },
  { value: 'year_desc', label: 'Рік: від нового' },
];

const sourceTypeOptions = [
  { value: '', label: 'Всі джерела' },
  { value: 'COPART', label: 'Copart' },
  { value: 'INTERNAL', label: 'Внутрішній' },
];

const selectClass = "w-full bg-white border border-border-strong rounded-sm px-3 py-2.5 text-[13px] text-fg appearance-none cursor-pointer focus:outline-none focus:border-green-500";
const inputClass = "w-full bg-white border border-border-strong rounded-sm px-3 py-2.5 text-[13px] text-fg placeholder-fg-subtle focus:outline-none focus:border-green-500";

export function VehicleFilters({
  filters,
  onFilterChange,
  filterOptions,
}: VehicleFiltersProps) {
  const [expanded, setExpanded] = useState(false);

  function update(patch: Partial<VehicleFiltersType>) {
    onFilterChange({ ...filters, ...patch, page: 1 });
  }

  function resetFilters() {
    onFilterChange({ page: 1, pageSize: filters.pageSize });
  }

  const hasActiveFilters = !!(
    filters.make ||
    filters.model ||
    filters.yearFrom ||
    filters.yearTo ||
    filters.priceFrom ||
    filters.priceTo ||
    filters.mileageFrom ||
    filters.mileageTo ||
    filters.bodyType ||
    filters.fuelType ||
    filters.transmission ||
    filters.driveType ||
    filters.sourceType
  );

  const filterPanel = (
    <div className="space-y-4">
      {/* Make & Model */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-fg mb-1.5">Марка</label>
          <select
            value={filters.make ?? ''}
            onChange={(e) => update({ make: e.target.value || undefined, model: undefined })}
            className={selectClass}
          >
            <option value="">Всі марки</option>
            {filterOptions.makes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-fg mb-1.5">Модель</label>
          <select
            value={filters.model ?? ''}
            onChange={(e) => update({ model: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">Всі моделі</option>
            {filterOptions.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Year range */}
      <div>
        <label className="block text-xs font-bold text-fg mb-1.5">Рік</label>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            placeholder={`Від ${filterOptions.yearRange.min}`}
            value={filters.yearFrom ?? ''}
            onChange={(e) =>
              update({ yearFrom: e.target.value ? Number(e.target.value) : undefined })
            }
            className={inputClass}
          />
          <input
            type="number"
            placeholder={`До ${filterOptions.yearRange.max}`}
            value={filters.yearTo ?? ''}
            onChange={(e) =>
              update({ yearTo: e.target.value ? Number(e.target.value) : undefined })
            }
            className={inputClass}
          />
        </div>
      </div>

      {/* Price range */}
      <div>
        <label className="block text-xs font-bold text-fg mb-1.5">Ціна, $</label>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            placeholder="Від"
            value={filters.priceFrom ?? ''}
            onChange={(e) =>
              update({ priceFrom: e.target.value ? Number(e.target.value) : undefined })
            }
            className={inputClass}
          />
          <input
            type="number"
            placeholder="До"
            value={filters.priceTo ?? ''}
            onChange={(e) =>
              update({ priceTo: e.target.value ? Number(e.target.value) : undefined })
            }
            className={inputClass}
          />
        </div>
      </div>

      {/* Mileage range */}
      <div>
        <label className="block text-xs font-bold text-fg mb-1.5">Пробіг, км</label>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            placeholder="Від"
            value={filters.mileageFrom ?? ''}
            onChange={(e) =>
              update({ mileageFrom: e.target.value ? Number(e.target.value) : undefined })
            }
            className={inputClass}
          />
          <input
            type="number"
            placeholder="До"
            value={filters.mileageTo ?? ''}
            onChange={(e) =>
              update({ mileageTo: e.target.value ? Number(e.target.value) : undefined })
            }
            className={inputClass}
          />
        </div>
      </div>

      {/* Selects row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-fg mb-1.5">Тип кузова</label>
          <select
            value={filters.bodyType ?? ''}
            onChange={(e) => update({ bodyType: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">Всі</option>
            {filterOptions.bodyTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-fg mb-1.5">Паливо</label>
          <select
            value={filters.fuelType ?? ''}
            onChange={(e) => update({ fuelType: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">Всі</option>
            {filterOptions.fuelTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-fg mb-1.5">КПП</label>
          <select
            value={filters.transmission ?? ''}
            onChange={(e) => update({ transmission: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">Всі</option>
            {filterOptions.transmissions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-fg mb-1.5">Привід</label>
          <select
            value={filters.driveType ?? ''}
            onChange={(e) => update({ driveType: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">Всі</option>
            {filterOptions.driveTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Source type */}
      <div>
        <label className="block text-xs font-bold text-fg mb-1.5">Джерело</label>
        <select
          value={filters.sourceType ?? ''}
          onChange={(e) => update({ sourceType: (e.target.value || undefined) as VehicleFiltersType['sourceType'] })}
          className={selectClass}
        >
          {sourceTypeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Sort */}
      <div>
        <label className="block text-xs font-bold text-fg mb-1.5">Сортування</label>
        <select
          value={filters.sort ?? 'createdAt_desc'}
          onChange={(e) => update({ sort: e.target.value })}
          className={selectClass}
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Reset */}
      {hasActiveFilters && (
        <button
          onClick={resetFilters}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] text-fg-muted bg-background hover:bg-border rounded-sm transition-colors font-semibold"
        >
          <X className="h-4 w-4" />
          Скинути фільтри
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0">{filterPanel}</aside>

      {/* Mobile expandable */}
      <div className="lg:hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 w-full px-4 py-3 mb-4 text-sm font-bold text-fg bg-white border border-border rounded-sm"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Фільтри
          {hasActiveFilters && (
            <span className="ml-auto w-2 h-2 rounded-full bg-green-500" />
          )}
        </button>
        {expanded && (
          <div className="mb-4 p-4 bg-white border border-border rounded-lg animate-fade-in">
            {filterPanel}
          </div>
        )}
      </div>
    </>
  );
}
