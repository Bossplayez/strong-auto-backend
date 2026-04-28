'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Calculator, CheckCircle, ArrowRight, Car } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { me } from '@/lib/api';
import type { Vehicle, PaginatedResponse } from '@/lib/types';

export default function DashboardPage() {
  const { user } = useAuth();
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [calculationsCount, setCalculationsCount] = useState(0);
  const [recentFavorites, setRecentFavorites] = useState<Vehicle[]>([]);

  const displayName = user?.profile?.firstName || user?.email || 'Користувач';

  useEffect(() => {
    async function loadData() {
      try {
        const [favRes, calcRes] = await Promise.all([
          me.getFavorites(1),
          me.getCalculations(1),
        ]);
        setFavoritesCount(favRes.meta.total);
        setCalculationsCount(calcRes.meta.total);
        setRecentFavorites(favRes.items.slice(0, 3));
      } catch {
        // Silently handle errors for dashboard stats
      }
    }
    loadData();
  }, []);

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="font-display font-bold text-fg" style={{ fontSize: 28 }}>
          Вітаємо, {displayName}!
        </h1>
        <p className="text-fg-muted mt-1 text-sm">Ваша панель управління</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-border rounded-lg p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Heart className="w-5 h-5 text-green-500" />
            </div>
            <span className="text-fg-muted text-sm">Обране</span>
          </div>
          <p className="text-2xl font-bold text-fg">{favoritesCount}</p>
        </div>

        <div className="bg-white border border-border rounded-lg p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Calculator className="w-5 h-5 text-green-500" />
            </div>
            <span className="text-fg-muted text-sm">Збережені розрахунки</span>
          </div>
          <p className="text-2xl font-bold text-fg">{calculationsCount}</p>
        </div>

        <div className="bg-white border border-border rounded-lg p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
            <span className="text-fg-muted text-sm">Статус</span>
          </div>
          <span className="inline-block px-3 py-1 text-sm font-bold bg-green-500/10 text-green-600 rounded-full">
            Active
          </span>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="font-display font-bold text-fg mb-3" style={{ fontSize: 20 }}>Швидкі дії</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/catalog"
            className="flex items-center justify-between bg-white border border-border rounded-lg p-5 hover:border-green-500 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Car className="w-5 h-5 text-green-500" />
              <span className="text-fg font-medium text-sm">Переглянути каталог</span>
            </div>
            <ArrowRight className="w-5 h-5 text-fg-subtle group-hover:text-green-500 transition-colors" />
          </Link>

          <Link
            href="/calculator"
            className="flex items-center justify-between bg-white border border-border rounded-lg p-5 hover:border-green-500 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Calculator className="w-5 h-5 text-green-500" />
              <span className="text-fg font-medium text-sm">Розрахувати вартість</span>
            </div>
            <ArrowRight className="w-5 h-5 text-fg-subtle group-hover:text-green-500 transition-colors" />
          </Link>
        </div>
      </div>

      {/* Recent favorites */}
      {recentFavorites.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-fg" style={{ fontSize: 20 }}>Останні обрані</h2>
            <Link
              href="/dashboard/favorites"
              className="text-sm text-green-600 hover:text-green-700 font-semibold transition-colors"
            >
              Переглянути всі
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {recentFavorites.map((vehicle: any) => {
              const primaryImage = vehicle.media?.find((m: any) => m.isPrimary) || vehicle.media?.[0];
              const imgUrl = primaryImage?.sourceUrl || primaryImage?.url;
              return (
                <Link
                  key={vehicle.id}
                  href={`/catalog/${vehicle.slug}`}
                  className="bg-white border border-border rounded-lg overflow-hidden hover:border-green-500 transition-colors"
                >
                  <div className="h-32 bg-navy-200 flex items-center justify-center">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={`${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Car className="w-8 h-8 text-navy-500" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-fg text-sm font-bold truncate">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </p>
                    <p className="text-green-600 text-sm font-bold mt-1">
                      ${Number(vehicle.priceAmount).toLocaleString()}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
