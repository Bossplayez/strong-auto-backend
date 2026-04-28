'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Car, Heart } from 'lucide-react';
import type { Vehicle } from '@/lib/types';
import { StatusTag } from './StatusTag';
import { PriceTag } from './PriceTag';
import { useAuth } from '@/hooks/useAuth';
import { me } from '@/lib/api';

interface VehicleCardProps {
  vehicle: Vehicle;
  isFavorite?: boolean;
  onFavoriteChange?: (vehicleId: string, isFav: boolean) => void;
}

const regionLabels: Record<string, string> = {
  UKRAINE: 'АВТО В УКРАЇНІ',
  USA: 'АВТО З США',
  EUROPE: 'АВТО З ЄВРОПИ',
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat('uk-UA').format(n);
}

export function VehicleCard({ vehicle, isFavorite: initialFav = false, onFavoriteChange }: VehicleCardProps) {
  const primaryMedia = vehicle.media?.[0];
  const imageUrl = primaryMedia?.sourceUrl || primaryMedia?.url;
  const statusLabel = regionLabels[vehicle.sourceRegion] || 'АВТО В УКРАЇНІ';
  const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
  const mileage = vehicle.odometerValue ?? vehicle.odometer;
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

  return (
    <Link href={`/catalog/${vehicle.slug}`} className="group block">
      <div className="bg-bg-card rounded overflow-hidden transition-all duration-150 hover:shadow-md">
        {/* Image */}
        <div className="relative overflow-hidden" style={{ height: 170, background: 'var(--navy-800)' }}>
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
          {/* Title + Price */}
          <div className="flex justify-between items-start gap-2 mb-3">
            <h3 className="font-display font-bold text-lg sm:text-[22px] leading-tight text-fg">
              {title}
            </h3>
            <PriceTag value={vehicle.priceAmount} size="sm" />
          </div>

          {/* Specs */}
          {[
            ['Двигун', vehicle.specs?.engineVolume || vehicle.fuelType || '—'],
            ['Пробіг', mileage != null ? `${formatNumber(mileage)} км` : '—'],
            ['Привід', vehicle.driveType || '—'],
            ['Коробка передач', vehicle.transmission || '—'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between text-[13px] gap-3 py-1">
              <span className="text-fg-muted whitespace-nowrap">{label}</span>
              <span className="font-semibold text-fg text-right truncate">{value}</span>
            </div>
          ))}

          {/* CTA */}
          <button
            className="mt-3 w-full bg-green-500 hover:bg-green-600 text-white py-2.5 rounded-sm font-semibold text-sm transition-colors"
            style={{ border: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            Детальніше
          </button>
        </div>
      </div>
    </Link>
  );
}
