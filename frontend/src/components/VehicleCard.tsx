import Link from 'next/link';
import { Car } from 'lucide-react';
import type { Vehicle } from '@/lib/types';
import { StatusTag } from './StatusTag';
import { PriceTag } from './PriceTag';

interface VehicleCardProps {
  vehicle: Vehicle;
}

const regionLabels: Record<string, string> = {
  UKRAINE: 'АВТО В УКРАЇНІ',
  USA: 'АВТО З США',
  EUROPE: 'АВТО З ЄВРОПИ',
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat('uk-UA').format(n);
}

export function VehicleCard({ vehicle }: VehicleCardProps) {
  const primaryMedia = vehicle.media?.find((m) => m.isPrimary) ?? vehicle.media?.[0];
  const statusLabel = regionLabels[vehicle.sourceRegion] || 'АВТО В УКРАЇНІ';
  const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;

  return (
    <Link href={`/catalog/${vehicle.slug}`} className="group block">
      <div className="bg-bg-card rounded overflow-hidden transition-all duration-150 hover:shadow-md">
        {/* Image */}
        <div className="relative overflow-hidden" style={{ height: 170, background: 'var(--navy-800)' }}>
          {primaryMedia ? (
            <img
              src={primaryMedia.url}
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
        </div>

        {/* Content */}
        <div style={{ padding: '14px 16px 16px' }}>
          {/* Title + Price */}
          <div className="flex justify-between items-center gap-2 mb-3">
            <h3 className="font-display font-bold text-[22px] leading-none text-fg">
              {title}
            </h3>
            <PriceTag value={vehicle.priceAmount} size="sm" />
          </div>

          {/* Specs */}
          {[
            ['Двигун', vehicle.specs?.engineVolume ? `${vehicle.specs.engineVolume}L` : vehicle.fuelType || '—'],
            ['Пробіг', vehicle.odometer != null ? `${formatNumber(vehicle.odometer)} км` : '—'],
            ['Привід', vehicle.driveType || '—'],
            ['Коробка передач', vehicle.transmission || '—'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between text-[13px] gap-2" style={{ padding: '5px 0' }}>
              <span className="text-fg-muted whitespace-nowrap">{label}</span>
              <span className="font-semibold text-fg whitespace-nowrap">{value}</span>
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
