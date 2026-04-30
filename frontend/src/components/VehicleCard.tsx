'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Car, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Vehicle, VehicleRegion } from '@/lib/types';
import { StatusTag } from './StatusTag';
import { PriceTag } from './PriceTag';
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

/** Get category-specific specs for the card */
function getCategorySpecs(vehicle: Vehicle): [string, string][] {
  const base: [string, string][] = [];
  const engine = vehicle.specs?.engineVolume || vehicle.fuelType || '—';
  const mileage = vehicle.odometerValue ?? vehicle.odometer;

  base.push(['Двигун', engine]);
  base.push(['Пробіг', mileage != null ? `${formatNumber(mileage)} км` : '—']);
  base.push(['Привід', vehicle.driveType || '—']);
  base.push(['КПП', vehicle.transmission || '—']);

  const region = vehicle.sourceRegion;

  if (region === 'UKRAINE') {
    if (vehicle.locationCity) base.push(['Місто', vehicle.locationCity]);
  } else if (region === 'USA') {
    if (vehicle.damage || vehicle.damagePrimary)
      base.push(['Пошкодження', vehicle.damagePrimary || vehicle.damage || '—']);
    if (vehicle.specs?.keys) base.push(['Ключі', vehicle.specs.keys]);
  } else if (region === 'EUROPE') {
    if (vehicle.locationCountry) base.push(['Країна', vehicle.locationCountry]);
  }

  return base;
}

export function VehicleCard({
  vehicle,
  layout = 'grid',
  isFavorite: initialFav = false,
  onFavoriteChange,
}: VehicleCardProps) {
  const allMedia = (vehicle.media || [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const [photoIndex, setPhotoIndex] = useState(0);
  const currentMedia = allMedia[photoIndex];
  const imageUrl = currentMedia?.sourceUrl || currentMedia?.url;
  const statusLabel = regionLabels[vehicle.sourceRegion] || 'АВТО В УКРАЇНІ';
  const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
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

  const specs = getCategorySpecs(vehicle);

  // ─── LIST (horizontal) layout ───────────────────────────
  if (layout === 'list') {
    return (
      <Link href={`/catalog/${vehicle.slug}`} className="group block">
        <div className="bg-bg-card rounded overflow-hidden transition-all duration-150 hover:shadow-md flex flex-col sm:flex-row">
          {/* Image section */}
          <div
            className="relative overflow-hidden shrink-0 w-full sm:w-[320px] lg:w-[380px]"
            style={{ minHeight: 200, background: 'var(--navy-800)' }}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={title}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                style={{ minHeight: 200 }}
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full min-h-[200px]">
                <Car className="h-12 w-12 text-navy-600" />
              </div>
            )}
            {/* Status badge */}
            <div className="absolute top-2.5 left-2.5">
              <StatusTag>{statusLabel}</StatusTag>
            </div>
            {/* Photo counter */}
            {allMedia.length > 1 && (
              <div className="absolute bottom-2.5 right-2.5 bg-black/60 text-white text-[11px] font-medium px-2 py-0.5 rounded">
                {photoIndex + 1} / {allMedia.length}
              </div>
            )}
            {/* Nav arrows */}
            {allMedia.length > 1 && (
              <>
                <button
                  onClick={prevPhoto}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={nextPhoto}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
            {/* Favorite */}
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

          {/* Content section */}
          <div className="flex-1 p-4 sm:p-5 flex flex-col justify-between">
            {/* Title + Price */}
            <div>
              <div className="flex justify-between items-start gap-3 mb-3">
                <h3 className="font-display font-bold text-xl sm:text-2xl leading-tight text-fg">
                  {title}
                </h3>
                <PriceTag value={vehicle.priceAmount} size="sm" />
              </div>

              {/* Specs grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {specs.map(([label, value]) => (
                  <div key={label} className="flex justify-between text-[13px] gap-2 py-0.5">
                    <span className="text-fg-muted whitespace-nowrap">{label}</span>
                    <span className="font-semibold text-fg text-right truncate">
                      {value}
                    </span>
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

            {/* CTA */}
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
        {/* Image */}
        <div
          className="relative overflow-hidden"
          style={{ height: 170, background: 'var(--navy-800)' }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex items-center justify-center w-full h-full">
              <Car className="h-12 w-12 text-navy-600" />
            </div>
          )}
          <div className="absolute top-2.5 left-2.5">
            <StatusTag>{statusLabel}</StatusTag>
          </div>
          {/* Photo counter */}
          {allMedia.length > 1 && (
            <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[11px] font-medium px-2 py-0.5 rounded">
              {photoIndex + 1} / {allMedia.length}
            </div>
          )}
          {/* Nav arrows */}
          {allMedia.length > 1 && (
            <>
              <button
                onClick={prevPhoto}
                className="absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={nextPhoto}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm text-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
              >
                <ChevronRight className="h-4 w-4" />
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

        {/* Content */}
        <div className="p-3.5 sm:p-4">
          <div className="flex justify-between items-start gap-2 mb-3">
            <h3 className="font-display font-bold text-lg sm:text-[22px] leading-tight text-fg">
              {title}
            </h3>
            <PriceTag value={vehicle.priceAmount} size="sm" />
          </div>
          {specs.slice(0, 4).map(([label, value]) => (
            <div key={label} className="flex justify-between text-[13px] gap-3 py-1">
              <span className="text-fg-muted whitespace-nowrap">{label}</span>
              <span className="font-semibold text-fg text-right truncate">{value}</span>
            </div>
          ))}
          <button className="mt-3 w-full bg-green-500 hover:bg-green-600 text-white py-2.5 rounded-sm font-semibold text-sm transition-colors">
            Детальніше
          </button>
        </div>
      </div>
    </Link>
  );
}
