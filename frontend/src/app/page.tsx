'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, ChevronDown, Truck } from 'lucide-react';
import { VehicleCard } from '@/components/VehicleCard';
import api from '@/lib/api';
import type { Vehicle, FilterOptions } from '@/lib/types';

const categoryTabs = [
  { label: 'Аукціон (США)', value: 'USA', href: '/catalog/usa' },
  { label: 'Авто в дорозі', value: 'TRANSIT', href: '/catalog/transit' },
  { label: 'Авто в Україні', value: 'UKRAINE', href: '/catalog/ukraine' },
  { label: 'Авто з Європи', value: 'EUROPE', href: '/catalog/europe' },
];

const sourceRegionOptions = [
  { value: '', label: 'Всі типи' },
  { value: 'USA', label: 'Аукціон (США)' },
  { value: 'UKRAINE', label: 'В Україні' },
  { value: 'EUROPE', label: 'З Європи' },
];

const yearRangeOptions = [
  { value: '', label: 'Всі роки' },
  { value: '2023-2026', label: '2023–2026' },
  { value: '2020-2022', label: '2020–2022' },
  { value: '2015-2019', label: '2015–2019' },
  { value: '2010-2014', label: '2010–2014' },
];

export default function HomePage() {
  const router = useRouter();
  const [hotVehicles, setHotVehicles] = useState<Vehicle[]>([]);
  const [usaVehicles, setUsaVehicles] = useState<Vehicle[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedMake, setSelectedMake] = useState('');
  const [selectedBodyType, setSelectedBodyType] = useState('');
  const [selectedYearRange, setSelectedYearRange] = useState('');
  const [activeTab, setActiveTab] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const [hotRes, usaRes, filtersRes] = await Promise.allSettled([
          api.catalog.getVehicles({ pageSize: 6, sort: 'created_desc' }),
          api.catalog.getVehicles({ pageSize: 6, sort: 'created_desc', sourceRegion: 'USA' }),
          api.catalog.getFilterOptions(),
        ]);
        if (hotRes.status === 'fulfilled') setHotVehicles(hotRes.value.items || []);
        if (usaRes.status === 'fulfilled') setUsaVehicles(usaRes.value.items || []);
        if (filtersRes.status === 'fulfilled') setFilterOptions(filtersRes.value);
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  function handleSearch() {
    const params = new URLSearchParams();
    if (selectedRegion) params.set('sourceRegion', selectedRegion);
    if (selectedMake) params.set('make', selectedMake);
    if (selectedBodyType) params.set('bodyType', selectedBodyType);
    if (selectedYearRange) {
      const [from, to] = selectedYearRange.split('-');
      params.set('yearFrom', from);
      params.set('yearTo', to);
    }
    router.push(`/catalog?${params.toString()}`);
  }

  function handleTabClick(value: string) {
    setActiveTab(value);
    setSelectedRegion(value);
  }

  return (
    <div>
      {/* ==================== HERO + SEARCH ==================== */}
      <section className="bg-white border-b border-border py-8 sm:py-12">
        <div className="max-w-container mx-auto px-4 sm:px-8">
          <h1 className="font-display font-bold text-fg leading-none text-3xl sm:text-4xl lg:text-[56px]">
            Авто з США<br />та Європи
          </h1>
          <p className="text-fg-muted mt-2 mb-5 sm:mb-6 text-sm sm:text-base">
            Прозорі ціни. Доставка та розмитнення під ключ.
          </p>

          {/* Dark search bar */}
          <div
            className="rounded-lg p-4 sm:p-5 grid gap-3 grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]"
            style={{ background: 'var(--navy-800)' }}
          >
            <div>
              <div className="eyebrow mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>Тип авто</div>
              <div className="relative">
                <select
                  value={selectedRegion}
                  onChange={(e) => setSelectedRegion(e.target.value)}
                  className="w-full bg-white rounded-sm px-3 py-2.5 text-sm font-medium text-fg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500/30"
                >
                  {sourceRegionOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle pointer-events-none" />
              </div>
            </div>

            <div>
              <div className="eyebrow mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>Марка</div>
              <div className="relative">
                <select
                  value={selectedMake}
                  onChange={(e) => setSelectedMake(e.target.value)}
                  className="w-full bg-white rounded-sm px-3 py-2.5 text-sm font-medium text-fg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500/30"
                >
                  <option value="">Всі марки</option>
                  {(filterOptions?.makes || []).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle pointer-events-none" />
              </div>
            </div>

            <div>
              <div className="eyebrow mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>Кузов</div>
              <div className="relative">
                <select
                  value={selectedBodyType}
                  onChange={(e) => setSelectedBodyType(e.target.value)}
                  className="w-full bg-white rounded-sm px-3 py-2.5 text-sm font-medium text-fg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500/30"
                >
                  <option value="">Всі кузови</option>
                  {(filterOptions?.bodyTypes || []).map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle pointer-events-none" />
              </div>
            </div>

            <div>
              <div className="eyebrow mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>Рік</div>
              <div className="relative">
                <select
                  value={selectedYearRange}
                  onChange={(e) => setSelectedYearRange(e.target.value)}
                  className="w-full bg-white rounded-sm px-3 py-2.5 text-sm font-medium text-fg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500/30"
                >
                  {yearRangeOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle pointer-events-none" />
              </div>
            </div>

            <button
              onClick={handleSearch}
              className="col-span-2 lg:col-span-1 self-end bg-green-500 hover:bg-green-600 text-white px-6 rounded-sm font-bold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap h-10"
            >
              <Search className="h-4 w-4" />
              Показати авто
            </button>
          </div>

          {/* Category chips */}
          <div className="flex flex-wrap gap-2 mt-4">
            {categoryTabs.map((tab) => (
              <Link
                key={tab.value}
                href={tab.href}
                className="text-[13px] font-semibold px-3.5 py-1.5 rounded-sm transition-colors bg-white text-fg border border-border-strong hover:bg-navy-800 hover:text-white hover:border-navy-800"
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== HOT OFFERS ==================== */}
      <section className="py-8 sm:py-10 px-4 sm:px-8 max-w-container mx-auto">
        <div className="flex justify-between items-baseline mb-5">
          <h2 className="font-display font-bold text-fg text-2xl sm:text-3xl lg:text-[36px]">
            Гарячі пропозиції
          </h2>
          <Link href="/catalog" className="text-sm font-semibold text-green-600 hover:text-green-700 transition-colors">
            Дивитись усі &rarr;
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
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
        ) : hotVehicles.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {hotVehicles.map((v) => (
              <VehicleCard key={v.id} vehicle={v} />
            ))}
          </div>
        ) : (
          <p className="text-fg-muted text-center py-12">Поки що немає пропозицій</p>
        )}
        <div className="text-center mt-6">
          <Link
            href="/catalog"
            className="inline-flex px-8 py-3 text-sm font-semibold text-fg bg-white border border-border-strong hover:bg-background rounded-sm transition-colors"
          >
            Показати більше
          </Link>
        </div>
      </section>

      {/* ==================== CALCULATOR + TRANSIT BLOCK ==================== */}
      <section className="px-4 sm:px-8 pb-8 sm:pb-10 max-w-container mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Calculator promo */}
          <div className="bg-navy-800 text-white rounded-lg p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <div className="eyebrow mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Калькулятор
              </div>
              <h2 className="font-display font-bold leading-tight mb-3 text-2xl sm:text-3xl lg:text-[36px]">
                Розрахуйте вартість авто за 30 секунд
              </h2>
              <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Аукціонна ціна, доставка, розмитнення, страхування — все в одній сумі.
              </p>
            </div>
            <Link
              href="/calculator"
              className="self-start bg-green-500 hover:bg-green-600 text-white px-7 py-3.5 rounded-sm font-bold text-sm transition-colors"
            >
              Розрахувати вартість
            </Link>
          </div>

          {/* Transit tracker */}
          <div className="bg-white rounded-lg p-6 flex flex-col justify-between">
            <div>
              <div className="eyebrow mb-2">Авто в дорозі</div>
              <h2 className="font-display font-bold text-fg leading-tight mb-3 text-xl sm:text-2xl lg:text-[30px]">
                Слідкуйте за авто на шляху до Києва
              </h2>
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <Truck className="h-4 w-4" />
                <span>ETA — найближчий контейнер</span>
              </div>
            </div>
            <Link
              href="/catalog?sourceRegion=transit"
              className="text-green-600 hover:text-green-700 font-semibold text-sm mt-6 transition-colors"
            >
              Дивитись авто в дорозі &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* ==================== USA VEHICLES SECTION ==================== */}
      {usaVehicles.length > 0 && (
        <section className="py-8 sm:py-10 px-4 sm:px-8 max-w-container mx-auto">
          <div className="flex justify-between items-baseline mb-5">
            <div>
              <div className="eyebrow mb-1">АУКЦІОН США — НАЙКРАЩІ ЦІНИ</div>
              <h2 className="font-display font-bold text-fg text-2xl sm:text-3xl lg:text-[36px]">
                Авто з США
              </h2>
            </div>
            <Link href="/catalog?sourceRegion=USA" className="text-sm font-semibold text-green-600 hover:text-green-700 transition-colors">
              Дивитись усі &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {usaVehicles.map((v) => (
              <VehicleCard key={v.id} vehicle={v} />
            ))}
          </div>
          <div className="text-center mt-6">
            <Link
              href="/catalog?sourceRegion=USA"
              className="inline-flex px-8 py-3 text-sm font-semibold text-fg bg-white border border-border-strong hover:bg-background rounded-sm transition-colors"
            >
              Показати більше
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
