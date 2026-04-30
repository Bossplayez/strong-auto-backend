'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, SlidersHorizontal } from 'lucide-react';
import api from '@/lib/api';
import type { Vehicle, VehicleFilters as VehicleFiltersType, PaginatedResponse, FilterOptions } from '@/lib/types';
import { VehicleCard } from '@/components/VehicleCard';
import { FilterChips } from '@/components/FilterChips';

const categoryTabs = [
  { label: 'Всі', value: '', href: '/catalog' },
  { label: 'Авто в Україні', value: 'UKRAINE', href: '/catalog/ukraine' },
  { label: 'Авто в дорозі', value: 'TRANSIT', href: '/catalog/transit' },
  { label: 'Аукціон (США)', value: 'USA', href: '/catalog/usa' },
  { label: 'Авто в Європі', value: 'EUROPE', href: '/catalog/europe' },
];

const sortOptions = [
  { value: 'created_desc', label: 'Найновіші' },
  { value: 'price_asc', label: 'За ціною ↑' },
  { value: 'price_desc', label: 'За ціною ↓' },
  { value: 'year_desc', label: 'За роком ↓' },
];

interface CatalogContentProps {
  /** Fixed category for this page (empty string = all) */
  category: string;
  /** Page title */
  title: string;
}

export function CatalogContentWrapper({ category, title }: CatalogContentProps) {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-green-500" /></div>}>
      <CatalogContent category={category} title={title} />
    </Suspense>
  );
}

function CatalogContent({ category, title }: CatalogContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<Vehicle>['meta'] | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Current category base path for building URLs
  const basePath = categoryTabs.find((t) => t.value === category)?.href || '/catalog';

  const getFiltersFromParams = useCallback((): VehicleFiltersType => {
    const filters: VehicleFiltersType = {};
    const fields = ['make', 'model', 'yearFrom', 'yearTo', 'priceFrom', 'priceTo',
      'mileageFrom', 'mileageTo', 'bodyType', 'fuelType', 'transmission',
      'driveType', 'sourceType', 'sort', 'page', 'pageSize'] as const;
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
    // Inject category from route, not from query params
    if (category) {
      filters.sourceRegion = category as VehicleFiltersType['sourceRegion'];
    }
    return filters;
  }, [searchParams, category]);

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
    // Remove sourceRegion from query — it's in the URL path
    const { sourceRegion: _, ...rest } = { ...current, ...patch, page: 1 };
    const params = new URLSearchParams();
    Object.entries(rest).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== null) {
        params.set(key, String(value));
      }
    });
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const resetFilters = () => {
    router.push(basePath);
  };

  const removeFilter = (key: keyof VehicleFiltersType) => {
    updateFilters({ [key]: undefined });
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    router.push(`${basePath}?${params.toString()}`);
  };

  const filters = getFiltersFromParams();

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

  const RangeField = ({ label, fromValue, toValue, fromPlaceholder, toPlaceholder, onFromChange, onToChange }: {
    label: string; fromValue: number | undefined; toValue: number | undefined;
    fromPlaceholder: string; toPlaceholder: string;
    onFromChange: (v: number | undefined) => void; onToChange: (v: number | undefined) => void;
  }) => (
    <div className="mb-3.5">
      <div className="text-xs font-bold mb-1.5 text-fg">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          placeholder={fromPlaceholder}
          value={fromValue ?? ''}
          onChange={(e) => onFromChange(e.target.value ? Number(e.target.value) : undefined)}
          className="w-full bg-white border border-border-strong rounded-sm px-3 py-2.5 text-[13px] text-fg placeholder-fg-subtle focus:outline-none focus:border-green-500"
        />
        <input
          type="number"
          placeholder={toPlaceholder}
          value={toValue ?? ''}
          onChange={(e) => onToChange(e.target.value ? Number(e.target.value) : undefined)}
          className="w-full bg-white border border-border-strong rounded-sm px-3 py-2.5 text-[13px] text-fg placeholder-fg-subtle focus:outline-none focus:border-green-500"
        />
      </div>
    </div>
  );

  const filterSidebar = (
    <>
      <div className="font-display font-bold text-fg mb-3.5" style={{ fontSize: 22 }}>Фільтри</div>
      <SelectField label="Марка" value={filters.make || ''} options={[{ value: '', label: 'Всі марки' }, ...(filterOptions?.makes || []).map((m) => ({ value: m, label: m }))]} onChange={(v) => updateFilters({ make: v || undefined, model: undefined })} />
      <SelectField label="Модель" value={filters.model || ''} options={[{ value: '', label: 'Всі моделі' }, ...(filterOptions?.models || []).map((m) => ({ value: m, label: m }))]} onChange={(v) => updateFilters({ model: v || undefined })} />
      <RangeField label="Рік" fromValue={filters.yearFrom} toValue={filters.yearTo} fromPlaceholder={`Від ${filterOptions?.yearRange?.min ?? ''}`} toPlaceholder={`До ${filterOptions?.yearRange?.max ?? ''}`} onFromChange={(v) => updateFilters({ yearFrom: v })} onToChange={(v) => updateFilters({ yearTo: v })} />
      <RangeField label="Ціна, $" fromValue={filters.priceFrom} toValue={filters.priceTo} fromPlaceholder="Від" toPlaceholder="До" onFromChange={(v) => updateFilters({ priceFrom: v })} onToChange={(v) => updateFilters({ priceTo: v })} />
      <RangeField label="Пробіг, км" fromValue={filters.mileageFrom} toValue={filters.mileageTo} fromPlaceholder="Від" toPlaceholder="До" onFromChange={(v) => updateFilters({ mileageFrom: v })} onToChange={(v) => updateFilters({ mileageTo: v })} />
      <SelectField label="Тип кузова" value={filters.bodyType || ''} options={[{ value: '', label: 'Всі' }, ...(filterOptions?.bodyTypes || []).map((t) => ({ value: t, label: t }))]} onChange={(v) => updateFilters({ bodyType: v || undefined })} />
      <SelectField label="Тип палива" value={filters.fuelType || ''} options={[{ value: '', label: 'Всі' }, ...(filterOptions?.fuelTypes || []).map((t) => ({ value: t, label: t }))]} onChange={(v) => updateFilters({ fuelType: v || undefined })} />
      <SelectField label="Привід" value={filters.driveType || ''} options={[{ value: '', label: 'Всі' }, ...(filterOptions?.driveTypes || []).map((t) => ({ value: t, label: t }))]} onChange={(v) => updateFilters({ driveType: v || undefined })} />
      <SelectField label="Коробка передач" value={filters.transmission || ''} options={[{ value: '', label: 'Всі' }, ...(filterOptions?.transmissions || []).map((t) => ({ value: t, label: t }))]} onChange={(v) => updateFilters({ transmission: v || undefined })} />
      <button onClick={resetFilters} className="w-full text-fg-muted hover:text-fg font-semibold text-[13px] py-2.5 mt-1 transition-colors">Очистити фільтри</button>
    </>
  );

  return (
    <div className="pb-20 lg:pb-0">
      <div className="bg-white border-b border-border px-4 sm:px-8 py-4 sm:py-5">
        <h1 className="font-display font-bold text-fg text-2xl sm:text-[32px]">{title}</h1>
        {meta && <div className="text-[13px] text-fg-muted mt-1">Знайдено {meta.total.toLocaleString()} авто</div>}
      </div>

      <div className="flex gap-4 px-4 sm:px-8 py-4 sm:py-5 max-w-container mx-auto">
        <aside className="hidden lg:block w-[240px] shrink-0 bg-white rounded-lg self-start sticky top-4 overflow-y-auto" style={{ padding: 18, maxHeight: 'calc(100vh - 100px)' }}>{filterSidebar}</aside>

        {mobileFiltersOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileFiltersOpen(false)} />
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto p-5">
              <div className="flex justify-between items-center mb-4">
                <span className="font-display font-bold text-lg text-fg">Фільтри</span>
                <button onClick={() => setMobileFiltersOpen(false)} className="text-fg-muted hover:text-fg text-sm font-semibold">Закрити</button>
              </div>
              {filterSidebar}
              <button onClick={() => setMobileFiltersOpen(false)} className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-sm font-bold text-sm transition-colors mt-3">Показати результати</button>
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Category tabs as links */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2.5 mb-3.5">
            <div className="flex flex-wrap gap-1.5">
              {categoryTabs.map((tab) => (
                <Link
                  key={tab.value}
                  href={tab.href}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-xs transition-colors ${
                    category === tab.value
                      ? 'bg-navy-800 text-white'
                      : 'bg-white text-fg border border-border-strong hover:bg-background'
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
            <div className="text-[13px] text-fg-muted">
              Сортувати:{' '}
              <select value={filters.sort || 'created_desc'} onChange={(e) => updateFilters({ sort: e.target.value })} className="font-semibold text-fg bg-transparent border-none cursor-pointer focus:outline-none">
                {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <FilterChips filters={filters} onRemove={removeFilter} onReset={resetFilters} />

          {loading ? (
            <>
              <div className="hidden lg:flex flex-col gap-3.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="bg-bg-card rounded overflow-hidden animate-pulse flex">
                    <div className="w-[380px] h-[200px] bg-navy-200 shrink-0" />
                    <div className="flex-1 p-5 space-y-3"><div className="h-6 w-2/3 rounded bg-navy-100" /><div className="h-4 w-1/3 rounded bg-navy-100" /><div className="grid grid-cols-2 gap-3 mt-2"><div className="h-4 rounded bg-navy-100" /><div className="h-4 rounded bg-navy-100" /></div></div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 lg:hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-bg-card rounded overflow-hidden animate-pulse"><div className="h-[170px] bg-navy-200" /><div className="p-4 space-y-3"><div className="h-5 w-3/4 rounded bg-navy-100" /><div className="h-4 w-1/2 rounded bg-navy-100" /></div></div>
                ))}
              </div>
            </>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
              <p className="text-red-600">{error}</p>
              <button onClick={fetchVehicles} className="mt-4 px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-sm">Спробувати знову</button>
            </div>
          ) : vehicles.length === 0 ? (
            <div className="rounded-lg bg-white border border-border p-12 text-center">
              <p className="text-lg text-fg-muted">За вашим запитом нічого не знайдено</p>
              <p className="mt-2 text-sm text-fg-subtle">Спробуйте змінити фільтри</p>
            </div>
          ) : (
            <>
              <div className="hidden lg:flex flex-col gap-3.5">
                {vehicles.map((v) => <VehicleCard key={v.id} vehicle={v} layout="list" />)}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 lg:hidden">
                {vehicles.map((v) => <VehicleCard key={v.id} vehicle={v} layout="grid" />)}
              </div>

              {meta && meta.totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <button onClick={() => handlePageChange(meta.page - 1)} disabled={meta.page <= 1} className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-white text-fg transition hover:border-green-500 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  {Array.from({ length: meta.totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === meta.totalPages || Math.abs(p - meta.page) <= 2)
                    .reduce<(number | string)[]>((acc, p, idx, arr) => { if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...'); acc.push(p); return acc; }, [])
                    .map((item, idx) =>
                      typeof item === 'string' ? <span key={`dots-${idx}`} className="px-2 text-fg-subtle">...</span> : (
                        <button key={item} onClick={() => handlePageChange(item)} className={`flex h-10 w-10 items-center justify-center rounded-sm border text-sm font-medium transition ${item === meta.page ? 'border-green-500 bg-green-500 text-white' : 'border-border bg-white text-fg hover:border-green-500'}`}>{item}</button>
                      )
                    )}
                  <button onClick={() => handlePageChange(meta.page + 1)} disabled={meta.page >= meta.totalPages} className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-white text-fg transition hover:border-green-500 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border p-3 flex gap-3 lg:hidden z-40">
        <button className="flex-1 py-3 rounded-sm text-sm font-semibold text-fg border border-border-strong hover:bg-background transition-colors">Підписатись</button>
        <button onClick={() => setMobileFiltersOpen(true)} className="flex-1 py-3 rounded-sm text-sm font-semibold text-white bg-green-500 hover:bg-green-600 transition-colors flex items-center justify-center gap-2"><SlidersHorizontal className="h-4 w-4" />Фільтр</button>
      </div>
    </div>
  );
}
