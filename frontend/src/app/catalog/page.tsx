'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, X } from 'lucide-react';
import api from '@/lib/api';
import type { Vehicle, VehicleFilters as VehicleFiltersType, PaginatedResponse, FilterOptions } from '@/lib/types';
import { VehicleCard } from '@/components/VehicleCard';

const sourceTypeTabs = [
  { label: 'Аукціон (США)', value: 'USA' },
  { label: 'Авто в дорозі', value: 'transit' },
  { label: 'Авто в Україні', value: 'UKRAINE' },
];

const sortOptions = [
  { value: 'created_desc', label: 'Найновіші' },
  { value: 'price_asc', label: 'За ціною \u2191' },
  { value: 'price_desc', label: 'За ціною \u2193' },
  { value: 'year_desc', label: 'За роком \u2193' },
];

export default function CatalogPageWrapper() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-green-500" /></div>}>
      <CatalogPage />
    </Suspense>
  );
}

function CatalogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<Vehicle>['meta'] | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getFiltersFromParams = useCallback((): VehicleFiltersType => {
    const filters: VehicleFiltersType = {};
    const fields = ['make', 'model', 'yearFrom', 'yearTo', 'priceFrom', 'priceTo',
      'mileageFrom', 'mileageTo', 'bodyType', 'fuelType', 'transmission',
      'driveType', 'sourceType', 'sourceRegion', 'sort', 'page', 'pageSize'] as const;
    for (const key of fields) {
      const val = searchParams.get(key);
      if (val) {
        if (['yearFrom','yearTo','priceFrom','priceTo','mileageFrom','mileageTo','page','pageSize'].includes(key)) {
          (filters as Record<string, unknown>)[key] = Number(val);
        } else {
          (filters as Record<string, unknown>)[key] = val;
        }
      }
    }
    return filters;
  }, [searchParams]);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = getFiltersFromParams();
      const response = await api.catalog.getVehicles(filters);
      setVehicles(response.items);
      setMeta(response.meta);
    } catch {
      setError('Не вдалося завантажити каталог.');
    } finally {
      setLoading(false);
    }
  }, [getFiltersFromParams]);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  useEffect(() => {
    api.catalog.getFilterOptions().then(setFilterOptions).catch(() => {});
  }, []);

  const updateFilters = (patch: Partial<VehicleFiltersType>) => {
    const current = getFiltersFromParams();
    const merged = { ...current, ...patch, page: 1 };
    const params = new URLSearchParams();
    Object.entries(merged).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== null) {
        params.set(key, String(value));
      }
    });
    router.push(`/catalog?${params.toString()}`);
  };

  const resetFilters = () => {
    router.push('/catalog');
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    router.push(`/catalog?${params.toString()}`);
  };

  const filters = getFiltersFromParams();
  const activeSourceRegion = filters.sourceRegion || '';

  const SelectField = ({ label, value, options, onChange }: {
    label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void;
  }) => (
    <div className="mb-3.5">
      <div className="text-xs font-bold mb-1.5 text-fg">{label}</div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white border border-border-strong rounded-sm px-3 py-2.5 text-[13px] text-fg appearance-none cursor-pointer focus:outline-none focus:border-green-500"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-muted pointer-events-none" />
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="bg-white border-b border-border px-4 sm:px-8 py-4 sm:py-5">
        <h1 className="font-display font-bold text-fg text-2xl sm:text-[32px]">
          Авто з США та Європи
        </h1>
        {meta && (
          <div className="text-[13px] text-fg-muted mt-1">
            Знайдено {meta.total.toLocaleString()} авто
          </div>
        )}
      </div>

      <div className="flex gap-4 px-4 sm:px-8 py-4 sm:py-5 max-w-container mx-auto">
        {/* Filter sidebar */}
        <aside className="hidden lg:block w-[240px] shrink-0 bg-white rounded-lg p-4.5 self-start" style={{ padding: 18 }}>
          <div className="font-display font-bold text-fg mb-3.5" style={{ fontSize: 22 }}>
            Фільтри
          </div>

          <SelectField
            label="Марка"
            value={filters.make || ''}
            options={[
              { value: '', label: 'Всі марки' },
              ...(filterOptions?.makes || []).map((m) => ({ value: m, label: m })),
            ]}
            onChange={(v) => updateFilters({ make: v || undefined, model: undefined })}
          />

          <SelectField
            label="Тип кузова"
            value={filters.bodyType || ''}
            options={[
              { value: '', label: 'Всі' },
              ...(filterOptions?.bodyTypes || []).map((t) => ({ value: t, label: t })),
            ]}
            onChange={(v) => updateFilters({ bodyType: v || undefined })}
          />

          <SelectField
            label="Тип палива"
            value={filters.fuelType || ''}
            options={[
              { value: '', label: 'Всі' },
              ...(filterOptions?.fuelTypes || []).map((t) => ({ value: t, label: t })),
            ]}
            onChange={(v) => updateFilters({ fuelType: v || undefined })}
          />

          <SelectField
            label="Привід"
            value={filters.driveType || ''}
            options={[
              { value: '', label: 'Всі' },
              ...(filterOptions?.driveTypes || []).map((t) => ({ value: t, label: t })),
            ]}
            onChange={(v) => updateFilters({ driveType: v || undefined })}
          />

          <SelectField
            label="Коробка передач"
            value={filters.transmission || ''}
            options={[
              { value: '', label: 'Всі' },
              ...(filterOptions?.transmissions || []).map((t) => ({ value: t, label: t })),
            ]}
            onChange={(v) => updateFilters({ transmission: v || undefined })}
          />

          <button
            onClick={() => updateFilters(filters)}
            className="w-full bg-green-500 hover:bg-green-600 text-white py-2.5 rounded-sm font-bold text-[13px] transition-colors mt-1"
          >
            Застосувати
          </button>
          <button
            onClick={resetFilters}
            className="w-full text-fg-muted hover:text-fg font-semibold text-[13px] py-2.5 mt-1 transition-colors"
          >
            Очистити фільтри
          </button>
        </aside>

        {/* Main content */}
        <div className="flex-1">
          {/* Tabs + Sort row */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2.5 mb-3.5">
            <div className="flex flex-wrap gap-1.5">
              {sourceTypeTabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => updateFilters({ sourceRegion: tab.value as VehicleFiltersType['sourceRegion'] })}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-xs transition-colors ${
                    activeSourceRegion === tab.value
                      ? 'bg-navy-800 text-white'
                      : 'bg-white text-fg border border-border-strong hover:bg-background'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="text-[13px] text-fg-muted">
              Сортувати:{' '}
              <select
                value={filters.sort || 'created_desc'}
                onChange={(e) => updateFilters({ sort: e.target.value })}
                className="font-semibold text-fg bg-transparent border-none cursor-pointer focus:outline-none"
              >
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Vehicle grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="bg-bg-card rounded overflow-hidden animate-pulse">
                  <div className="h-[170px] bg-navy-200" />
                  <div className="p-4 space-y-3">
                    <div className="h-5 w-3/4 rounded bg-navy-100" />
                    <div className="h-4 w-1/2 rounded bg-navy-100" />
                    <div className="h-10 w-full rounded bg-navy-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
              <p className="text-red-600">{error}</p>
              <button onClick={fetchVehicles} className="mt-4 px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-sm">
                Спробувати знову
              </button>
            </div>
          ) : vehicles.length === 0 ? (
            <div className="rounded-lg bg-white border border-border p-12 text-center">
              <p className="text-lg text-fg-muted">За вашим запитом нічого не знайдено</p>
              <p className="mt-2 text-sm text-fg-subtle">Спробуйте змінити фільтри</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {vehicles.map((vehicle) => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))}
              </div>

              {/* Pagination */}
              {meta && meta.totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(meta.page - 1)}
                    disabled={meta.page <= 1}
                    className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-white text-fg transition hover:border-green-500 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: meta.totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === meta.totalPages || Math.abs(p - meta.page) <= 2)
                    .reduce<(number | string)[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      typeof item === 'string' ? (
                        <span key={`dots-${idx}`} className="px-2 text-fg-subtle">...</span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => handlePageChange(item)}
                          className={`flex h-10 w-10 items-center justify-center rounded-sm border text-sm font-medium transition ${
                            item === meta.page
                              ? 'border-green-500 bg-green-500 text-white'
                              : 'border-border bg-white text-fg hover:border-green-500'
                          }`}
                        >
                          {item}
                        </button>
                      )
                    )}
                  <button
                    onClick={() => handlePageChange(meta.page + 1)}
                    disabled={meta.page >= meta.totalPages}
                    className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-white text-fg transition hover:border-green-500 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
