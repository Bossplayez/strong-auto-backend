'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Heart, Loader2, X } from 'lucide-react';
import api from '@/lib/api';
import type { Vehicle, VehicleMedia } from '@/lib/types';
import { StatusTag } from '@/components/StatusTag';
import { PriceTag } from '@/components/PriceTag';
import { LeadForm } from '@/components/LeadForm';

const regionLabels: Record<string, string> = {
  UKRAINE: 'АВТО В УКРАЇНІ',
  USA: 'АВТО З США',
  EUROPE: 'АВТО З ЄВРОПИ',
};

export default function VehicleDetailPage() {
  const params = useParams<{ slug: string }>();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);

  useEffect(() => {
    async function fetchVehicle() {
      if (!params.slug) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.catalog.getVehicle(params.slug);
        setVehicle(data);
        const primary = data.media?.find((m: VehicleMedia) => m.isPrimary);
        setSelectedImage(primary?.url ?? data.media?.[0]?.url ?? null);
      } catch {
        setError('Не вдалося завантажити інформацію про автомобіль.');
      } finally {
        setLoading(false);
      }
    }
    fetchVehicle();
  }, [params.slug]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-500" />
      </div>
    );
  }

  if (error || !vehicle) {
    return (
      <div className="p-8 max-w-container mx-auto">
        <Link href="/catalog" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Назад до каталогу
        </Link>
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-red-600">{error ?? 'Автомобіль не знайдено'}</p>
        </div>
      </div>
    );
  }

  const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
  const statusLabel = regionLabels[vehicle.sourceRegion] || 'АВТО';
  const isAuction = vehicle.sourceType === 'COPART';
  const sortedMedia = [...(vehicle.media ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const translation = vehicle.contentTranslations?.find((t) => t.locale === 'uk') ?? vehicle.contentTranslations?.[0];

  const specs = [
    ['Рік випуску', String(vehicle.year)],
    ['Двигун', vehicle.specs?.engineVolume ? `${vehicle.specs.engineVolume}L` : null],
    ['Пробіг', vehicle.odometer ? `${vehicle.odometer.toLocaleString()} км` : null],
    ['Привід', vehicle.driveType],
    ['Коробка передач', vehicle.transmission],
    ['Колір', vehicle.specs?.color],
    ['Тип палива', vehicle.fuelType],
    ['Кузов', vehicle.bodyType],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div>
      <div className="p-6 max-w-container mx-auto" style={{ paddingTop: 24, paddingBottom: 32 }}>
        {/* Breadcrumb */}
        <Link href="/catalog" className="text-[13px] text-fg-muted hover:text-fg cursor-pointer">
          &larr; {isAuction ? 'Аукціон США' : 'Усі авто в Україні'}
        </Link>

        {/* Title row */}
        <div className="flex justify-between items-end mt-3 mb-5 gap-4">
          <div>
            <StatusTag variant={isAuction ? 'green' : 'default'}>{statusLabel}</StatusTag>
            <h1 className="font-display font-bold text-fg leading-none mt-1.5" style={{ fontSize: 48 }}>
              {title}
            </h1>
            {vehicle.vin && (
              <div className="text-[13px] text-fg-muted font-mono mt-1.5">
                VIN &middot; {vehicle.vin}
                {vehicle.specs?.lotNumber && <> &middot; LOT {vehicle.specs.lotNumber}</>}
              </div>
            )}
          </div>
          {!isAuction && <PriceTag value={vehicle.priceAmount} size="lg" />}
        </div>

        {/* Main grid: 2fr image + 1fr sidebar */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
          {/* LEFT: Image + specs */}
          <div>
            {/* Main image */}
            <div className="rounded-lg overflow-hidden relative" style={{ background: 'var(--navy-800)', height: 380 }}>
              {selectedImage ? (
                <Image src={selectedImage} alt={title} fill className="object-cover" sizes="(max-width: 1024px) 100vw, 66vw" />
              ) : (
                <div className="flex h-full items-center justify-center text-navy-500">Немає фото</div>
              )}
              <div className="absolute top-3.5 left-3.5">
                <StatusTag>{statusLabel}</StatusTag>
              </div>
              {sortedMedia.length > 1 && (
                <div className="absolute bottom-3.5 right-3.5 bg-black/60 text-white text-xs font-semibold px-2.5 py-1 rounded-xs">
                  1 / {sortedMedia.length}
                </div>
              )}
            </div>

            {/* Thumbnails */}
            {sortedMedia.length > 1 && (
              <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: `repeat(${Math.min(sortedMedia.length, 6)}, 1fr)` }}>
                {sortedMedia.slice(0, 6).map((media) => (
                  <button
                    key={media.id}
                    onClick={() => setSelectedImage(media.url)}
                    className={`rounded-xs overflow-hidden border-2 transition ${
                      selectedImage === media.url ? 'border-green-500' : 'border-transparent hover:border-border-strong'
                    }`}
                    style={{ background: 'var(--navy-700)', height: 56 }}
                  >
                    <Image src={media.url} alt={title} width={120} height={56} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Specs card */}
            <div className="bg-white rounded-lg p-6 mt-4">
              <h2 className="font-display font-bold text-fg mb-4" style={{ fontSize: 24 }}>
                Характеристики
              </h2>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {specs.map(([label, value]) => (
                  <div key={label} className="flex justify-between py-2 border-b border-border">
                    <span className="text-[13px] text-fg-muted">{label}</span>
                    <span className="text-[13px] font-semibold text-fg">{value}</span>
                  </div>
                ))}
              </div>

              {/* Description */}
              {translation?.description && (
                <div className="mt-5">
                  <div className="text-[13px] font-bold mb-2">Опис від продавця</div>
                  <div
                    className="text-sm text-fg-muted leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: translation.description }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Sidebar */}
          <div className="flex flex-col gap-4">
            {isAuction ? (
              /* ===== AUCTION SIDEBAR ===== */
              <>
                <div className="bg-white rounded-lg p-6">
                  <div className="eyebrow mb-1">Поточна ставка</div>
                  <div className="font-display font-bold text-green-500" style={{ fontSize: 48 }}>
                    ${vehicle.priceAmount.toLocaleString().replace(/,/g, ' ')}
                  </div>
                  <div className="text-[13px] text-fg-muted mb-4">
                    мінімальний крок $100
                  </div>
                  <div className="mb-3">
                    <label className="text-xs font-bold mb-1.5 block">Ваша максимальна ставка, $</label>
                    <input
                      type="text"
                      defaultValue={(vehicle.priceAmount + 100).toLocaleString().replace(/,/g, ' ')}
                      className="w-full h-11 px-3.5 rounded-sm border border-border-strong font-semibold text-[15px] focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30"
                    />
                  </div>
                  <button className="w-full bg-green-500 hover:bg-green-600 text-white py-3.5 rounded-sm font-bold text-sm transition-colors">
                    Конкурувати за аукціон
                  </button>
                  <button className="w-full mt-2 bg-white text-fg border border-border-strong py-3 rounded-sm font-semibold text-sm flex items-center justify-center gap-2 hover:bg-background transition-colors">
                    <Heart className="h-4 w-4" /> Додати в обране
                  </button>
                </div>

                {/* Cost breakdown */}
                <div className="bg-navy-800 text-white rounded-lg p-5">
                  <div className="eyebrow mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    Загальна вартість
                  </div>
                  <div className="font-display font-bold mb-3.5" style={{ fontSize: 18 }}>
                    З доставкою у Київ
                  </div>
                  {[
                    ['Ставка', `$${vehicle.priceAmount.toLocaleString().replace(/,/g, ' ')}`],
                    ['Аукціонні збори', '$640'],
                    ['Доставка US→UA', '$2 100'],
                    ['Розмитнення', '$3 850'],
                    ['Сервіс', '$500'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between text-[13px] py-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
                      <span>{label}</span>
                      <span className="font-semibold">{value}</span>
                    </div>
                  ))}
                  <div
                    className="flex justify-between font-display font-bold mt-2.5 pt-2.5"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: 22 }}
                  >
                    <span>Разом</span>
                    <span className="text-green-400">
                      ${(vehicle.priceAmount + 7090).toLocaleString().replace(/,/g, ' ')}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              /* ===== REGULAR LISTING SIDEBAR ===== */
              <>
                {/* Seller card */}
                <div className="bg-white rounded-lg p-5">
                  <div className="eyebrow mb-2">Продавець</div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-full bg-navy-700 shrink-0" />
                    <div>
                      <div className="font-bold text-[15px] text-fg">Strong Auto &middot; Київ</div>
                      <div className="text-xs text-fg-muted">Перевірений салон &middot; 4 роки</div>
                    </div>
                  </div>
                  <button className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-sm font-bold text-sm transition-colors">
                    (044) XXX-XX-XX
                  </button>
                  <button
                    onClick={() => setShowLeadForm(true)}
                    className="w-full mt-2 bg-white text-fg border border-border-strong py-2.5 rounded-sm font-semibold text-sm hover:bg-background transition-colors"
                  >
                    Отримати контакт продавця
                  </button>
                </div>

                {/* Delivery card */}
                <div className="bg-navy-800 text-white rounded-lg p-5">
                  <div className="eyebrow mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    Доставка
                  </div>
                  <h3 className="font-display font-bold mb-1" style={{ fontSize: 22 }}>
                    Доставка у ваше місто
                  </h3>
                  <p className="text-[13px] mb-3.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    Безкоштовно по Україні від $200 предоплати.
                  </p>
                  <a className="text-green-400 font-semibold text-[13px]">Детальніше &rarr;</a>
                </div>

                {/* Favorites button */}
                <button className="bg-white text-fg border border-border-strong py-3 rounded-sm font-semibold text-sm flex items-center justify-center gap-2 hover:bg-background transition-colors">
                  <Heart className="h-4 w-4" /> Додати в обране
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Lead Form Modal */}
      {showLeadForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 relative">
            <button
              onClick={() => setShowLeadForm(false)}
              className="absolute top-3 right-3 p-1 text-fg-muted hover:text-fg rounded"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="font-display font-bold text-fg text-xl mb-4">Залишити заявку</h2>
            {leadSubmitted ? (
              <div className="py-8 text-center">
                <p className="text-lg font-semibold text-green-600">Дякуємо! Вашу заявку отримано.</p>
                <p className="mt-2 text-sm text-fg-muted">Наш менеджер зв&#39;яжеться з вами найближчим часом.</p>
              </div>
            ) : (
              <LeadForm
                leadType="CATALOG_REQUEST"
                vehicleId={vehicle.id}
                onSuccess={() => setLeadSubmitted(true)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
