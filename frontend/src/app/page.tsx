'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, ChevronDown, Truck } from 'lucide-react';
import { VehicleCard } from '@/components/VehicleCard';
import type { Vehicle, PaginatedResponse } from '@/lib/types';

const categoryTabs = [
  { label: 'Аукціон (США)', value: 'USA', active: true },
  { label: 'Авто в дорозі', value: 'transit', active: false },
  { label: 'Авто в Україні', value: 'UKRAINE', active: false },
  { label: 'Авто з Європи', value: 'EUROPE', active: false },
  { label: 'ЗСУ', value: 'zsu', active: false },
];

export default function HomePage() {
  const [hotVehicles, setHotVehicles] = useState<Vehicle[]>([]);
  const [transitVehicles, setTransitVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchVehicles() {
      try {
        const { default: axios } = await import('axios');
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api';
        const [hotRes, transitRes] = await Promise.allSettled([
          axios.get<PaginatedResponse<Vehicle>>(`${apiBase}/vehicles`, {
            params: { pageSize: 6, sort: 'created_desc', sourceRegion: 'UKRAINE' },
          }),
          axios.get<PaginatedResponse<Vehicle>>(`${apiBase}/vehicles`, {
            params: { pageSize: 6, sort: 'created_desc', sourceRegion: 'USA' },
          }),
        ]);
        if (hotRes.status === 'fulfilled') setHotVehicles(hotRes.value.data.items || []);
        if (transitRes.status === 'fulfilled') setTransitVehicles(transitRes.value.data.items || []);
      } catch {
        // silently fail — sections just won't show
      } finally {
        setLoading(false);
      }
    }
    fetchVehicles();
  }, []);

  return (
    <div>
      {/* ==================== HERO + SEARCH ==================== */}
      <section className="bg-white border-b border-border" style={{ padding: '48px 0 32px' }}>
        <div className="max-w-container mx-auto px-8">
          <h1 className="font-display font-bold text-fg leading-none" style={{ fontSize: 56 }}>
            Авто з США<br />та Європи
          </h1>
          <p className="text-fg-muted mt-2 mb-6" style={{ fontSize: 16 }}>
            Прозорі ціни. Доставка та розмитнення під ключ.
          </p>

          {/* Dark search bar */}
          <div
            className="rounded-lg p-5 grid gap-3"
            style={{
              background: 'var(--navy-800)',
              gridTemplateColumns: 'repeat(4, 1fr) auto',
            }}
          >
            {[
              ['Тип авто', 'Аукціон (США)'],
              ['Марка', 'Всі марки'],
              ['Модель', 'Всі моделі'],
              ['Рік', '2020–2025'],
            ].map(([label, placeholder]) => (
              <div key={label}>
                <div className="eyebrow mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {label}
                </div>
                <div className="bg-white rounded-sm px-3 py-2.5 text-sm font-medium text-fg flex items-center justify-between cursor-pointer">
                  <span>{placeholder}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-fg-subtle" />
                </div>
              </div>
            ))}
            <Link
              href="/catalog"
              className="self-end bg-green-500 hover:bg-green-600 text-white px-6 rounded-sm font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap"
              style={{ height: 40 }}
            >
              <Search className="h-4 w-4" />
              Показати авто
            </Link>
          </div>

          {/* Category chips */}
          <div className="flex gap-2 mt-4">
            {categoryTabs.map((tab) => (
              <Link
                key={tab.value}
                href={`/catalog?sourceRegion=${tab.value}`}
                className={`text-[13px] font-semibold px-3.5 py-1.5 rounded-sm transition-colors ${
                  tab.active
                    ? 'bg-navy-800 text-white'
                    : 'bg-white text-fg border border-border-strong hover:bg-background'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== HOT OFFERS ==================== */}
      <section className="py-10 px-8 max-w-container mx-auto">
        <div className="flex justify-between items-baseline mb-5">
          <h2 className="font-display font-bold text-fg" style={{ fontSize: 36 }}>
            Гарячі пропозиції
          </h2>
          <Link href="/catalog" className="text-sm font-semibold text-green-600 hover:text-green-700 transition-colors">
            Дивитись усі &rarr;
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-3 gap-4">
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
          <div className="grid grid-cols-3 gap-4">
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
      <section className="px-8 pb-10 max-w-container mx-auto">
        <div className="grid grid-cols-2 gap-4">
          {/* Calculator promo */}
          <div className="bg-navy-800 text-white rounded-lg p-8 flex flex-col justify-between">
            <div>
              <div className="eyebrow mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Калькулятор
              </div>
              <h2 className="font-display font-bold leading-tight mb-3" style={{ fontSize: 36 }}>
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
              <h2 className="font-display font-bold text-fg leading-tight mb-3" style={{ fontSize: 30 }}>
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

      {/* ==================== IN TRANSIT SECTION ==================== */}
      {transitVehicles.length > 0 && (
        <section className="py-10 px-8 max-w-container mx-auto">
          <div className="flex justify-between items-baseline mb-5">
            <div>
              <div className="eyebrow mb-1">АВТО ВЖЕ В ДОРОЗІ — КУПУЙТЕ ДО ПРИБУТТЯ</div>
              <h2 className="font-display font-bold text-fg" style={{ fontSize: 36 }}>
                Авто в дорозі
              </h2>
            </div>
            <Link href="/catalog?sourceRegion=transit" className="text-sm font-semibold text-green-600 hover:text-green-700 transition-colors">
              Дивитись усі &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {transitVehicles.map((v) => (
              <VehicleCard key={v.id} vehicle={v} />
            ))}
          </div>
          <div className="text-center mt-6">
            <Link
              href="/catalog?sourceRegion=transit"
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
