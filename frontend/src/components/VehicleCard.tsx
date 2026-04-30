'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Car, Heart, ChevronLeft, ChevronRight, Gauge, Settings2, Fuel, MapPin, AlertTriangle, Key } from 'lucide-react';
import type { Vehicle } from '@/lib/types';
import { StatusTag } from './StatusTag';
import { useAuth } from '@/hooks/useAuth';
import { me } from '@/lib/api';

interface VehicleCardProps {
  vehicle: Vehicle;
  layout?: 'grid' | 'list';
  isFavorite?: boolean;
  onFavoriteChange?: (vehicleId: string, isFav: boolean) => void;
}

const regionLabels: Record<string, string> = {
  UKRAINE: 'АВТО В УКРАЇНІ',
  USA: 'АВТО З США',
  EUROPE: 'АВТО З ЄВРОПИ',
  TRANSIT: 'В ДОРОЗІ',
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat('uk-UA').format(n);
}

function formatPrice(n: number): string {
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}

// Approximate UAH rate (can be fetched from API later)
const USD_TO_UAH = 43.88;

/** Build engine display: "Дизель, 2.97 л" or "Electric" */
function getEngineDisplay(vehicle: Vehicle): string {
  const parts: string[] = [];
  if (vehicle.fuelType) parts.push(vehicle.fuelType);
  if (vehicle.specs?.engineVolume) parts.push(`${vehicle.specs.engineVolume} л`);
  return parts.join(', ') || '—';
}

/** Spec item with icon */
interface SpecItem {
  icon: React.ReactNode;
  value: string;
}

function getSpecs(vehicle: Vehicle): SpecItem[] {
  const mileage = vehicle.odometerValue ?? vehicle.odometer;
  const specs: SpecItem[] = [
    {
      icon: <Gauge className="h-3.5 w-3.5" />,
      value: mileage != null ? `${formatNumber(mileage)} км` : '—',
    },
    {
      icon: <Settings2 className="h-3.5 w-3.5" />,
      value: vehicle.transmission || '—',
    },
    {
      icon: <Fuel className="h-3.5 w-3.5" />,
      value: getEngineDisplay(vehicle),
    },
  ];

  const region = vehicle.sourceRegion;

  // Location for Ukraine and Europe
  if (region === 'UKRAINE' && vehicle.locationCity) {
    specs.push({ icon: <MapPin className="h-3.5 w-3.5" />, value: vehicle.locationCity });
  } else if (region === 'EUROPE' && vehicle.locationCountry) {
    specs.push({ icon: <MapPin className="h-3.5 w-3.5" />, value: vehicle.locationCountry });
  }

  // USA-specific
  if (region === 'USA') {
    if (vehicle.damage || vehicle.damagePrimary) {
      specs.push({
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        value: vehicle.damagePrimary || vehicle.damage || '—',
      });
    }
    if (vehicle.specs?.keys) {
      specs.push({ icon: <Key className="h-3.5 w-3.5" />, value: vehicle.specs.keys });
    }
  }

  return specs;
}

export function VehicleCard({
  vehicle,
  layout = 'grid',
  isFavorite: initialFav = false,
  onFavoriteChange,
}: VehicleCardProps) {
  const allMedia = (vehicle.media || [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const [photoIndex, setPhotoIndex] = useState(0);
  const currentMedia = allMedia[photoIndex];
  const imageUrl = currentMedia?.sourceUrl || currentMedia?.url;
  const statusLabel = regionLabels[vehicle.sourceRegion] || 'АВТО В УКРАЇНІ';
  const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
  const price = typeof vehicle.priceAmount === 'string' ? parseFloat(vehicle.priceAmount) : vehicle.priceAmount;
  const uahPrice = Math.round((price || 0) * USD_TO_UAH);
  const { isAuthenticated } = useAuth();
  const [isFav, setIsFav] = useState(initialFav);
  const [favLoading, setFavLoading] = useState(false);

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated || favLoading) return;
    setFavLoading(true);
    try {
      if (isFav) {
        await me.removeFavorite(vehicle.id);
        setIsFav(false);
        onFavoriteChange?.(vehicle.id, false);
      } else {
        await me.addFavorite(vehicle.id);
        setIsFav(true);
        onFavoriteChange?.(vehicle.id, true);
      }
    } catch {
      // ignore
    } finally {
      setFavLoading(false);
    }
  };

  const prevPhoto = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setPhotoIndex((i) => (i > 0 ? i - 1 : allMedia.length - 1));
    },
    [allMedia.length]
  );

  const nextPhoto = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setPhotoIndex((i) => (i < allMedia.length - 1 ? i + 1 : 0));
    },
    [allMedia.length]
  );

  const specs = getSpecs(vehicle);

  // Shared image section
  const imageSection = (isListLayout: boolean) => (
    <div
      className={`relative overflow-hidden ${
        isListLayout
          ? 'shrink-0 w-full sm:w-[320px] lg:w-[380px]'
          : ''
      }`}
      style={{ minHeight: isListLayout ? 200 : 170, background: 'var(--navy-800)' }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          style={{ minHeight: isListLayout ? 200 : 170 }}
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full" style={{ minHeight: isListLayout ? 200 : 170 }}>
          <Car className="h-12 w-12 text-navy-600" />
        </div>
      )}
      <div className="absolute top-2.5 left-2.5">
        <StatusTag>{statusLabel}</StatusTag>
      </div>
      {allMedia.length > 1 && (
        <div className="absolute bottom-2.5 right-2.5 bg-black/60 text-white text-[11px] font-medium px-2 py-0.5 rounded">
          {photoIndex + 1} / {allMedia.length}
        </div>
      )}
      {allMedia.length > 1 && (
        <>
          <button
            onClick={prevPhoto}
            className={`absolute left-1.5 top-1/2 -translate-y-1/2 ${isListLayout ? 'w-8 h-8' : 'w-7 h-7'} rounded-full bg-black/40 backdrop-blur-sm text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60`}
          >
            <ChevronLeft className={isListLayout ? 'h-5 w-5' : 'h-4 w-4'} />
          </button>
          <button
            onClick={nextPhoto}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 ${isListLayout ? 'w-8 h-8' : 'w-7 h-7'} rounded-full bg-black/40 backdrop-blur-sm text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60`}
          >
            <ChevronRight className={isListLayout ? 'h-5 w-5' : 'h-4 w-4'} />
          </button>
        </>
      )}
      {isAuthenticated && (
        <button
          onClick={toggleFavorite}
          className={`absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
            isFav
              ? 'bg-red-500/90 text-white'
              : 'bg-black/40 backdrop-blur-sm text-white/80 hover:bg-black/60'
          }`}
          title={isFav ? 'Видалити з обраного' : 'Додати в обране'}
        >
          <Heart className={`h-4 w-4 ${isFav ? 'fill-white' : ''}`} />
        </button>
      )}
    </div>
  );

  // ─── LIST (horizontal) layout ───────────────────────────
  if (layout === 'list') {
    return (
      <Link href={`/catalog/${vehicle.slug}`} className="group block">
        <div className="bg-bg-card rounded overflow-hidden transition-all duration-150 hover:shadow-md flex flex-col sm:flex-row">
          {imageSection(true)}

          <div className="flex-1 p-4 sm:p-5 flex flex-col justify-between">
            <div>
              {/* Title */}
              <h3 className="font-display font-bold text-xl sm:text-2xl leading-tight text-fg mb-2">
                {title}
              </h3>

              {/* Price — prominent */}
              <div className="mb-3">
                <span className="text-green-500 font-bold text-xl sm:text-2xl">
                  {formatPrice(price)} $
                </span>
                <span className="text-fg-muted text-sm ml-2">
                  · {formatNumber(uahPrice)} грн
                </span>
              </div>

              {/* Specs with icons — 2 col grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {specs.map((spec, i) => (
                  <div key={i} className="flex items-center gap-2 text-[13px] text-fg-muted">
                    <span className="text-fg-subtle">{spec.icon}</span>
                    <span className="font-medium text-fg">{spec.value}</span>
                  </div>
                ))}
              </div>

              {/* Description snippet */}
              {vehicle.contentTranslations?.[0]?.description && (
                <p className="mt-2.5 text-[13px] text-fg-muted line-clamp-2">
                  {vehicle.contentTranslations[0].description}
                </p>
              )}
            </div>

            <button className="mt-3 sm:mt-4 self-start bg-green-500 hover:bg-green-600 text-white px-6 py-2.5 rounded-sm font-semibold text-sm transition-colors">
              Детальніше
            </button>
          </div>
        </div>
      </Link>
    );
  }

  // ─── GRID (vertical) layout ─────────────────────────────
  return (
    <Link href={`/catalog/${vehicle.slug}`} className="group block">
      <div className="bg-bg-card rounded overflow-hidden transition-all duration-150 hover:shadow-md">
        {imageSection(false)}

        <div className="p-3.5 sm:p-4">
          {/* Title */}
          <h3 className="font-display font-bold text-lg leading-tight text-fg mb-1.5">
            {title}
          </h3>

          {/* Price — prominent */}
          <div className="mb-3">
            <span className="text-green-500 font-bold text-lg">
              {formatPrice(price)} $
            </span>
            <span className="text-fg-muted text-xs ml-1.5">
              · {formatNumber(uahPrice)} грн
            </span>
          </div>

          {/* Specs with icons — compact */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {specs.slice(0, 4).map((spec, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                <span className="text-fg-subtle">{spec.icon}</span>
                <span className="font-medium text-fg truncate">{spec.value}</span>
              </div>
            ))}
          </div>

          <button className="mt-3 w-full bg-green-500 hover:bg-green-600 text-white py-2.5 rounded-sm font-semibold text-sm transition-colors">
            Детальніше
          </button>
        </div>
      </div>
    </Link>
  );
}
