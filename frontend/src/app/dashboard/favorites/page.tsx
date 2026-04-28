'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Heart, Car, ChevronLeft, ChevronRight } from 'lucide-react';
import { me } from '@/lib/api';
import type { Vehicle, PaginatedResponse } from '@/lib/types';

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<Vehicle[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<Vehicle>['meta'] | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFavorites = useCallback(async (p: number) => {
    setIsLoading(true);
    try {
      const res = await me.getFavorites(p);
      setFavorites(res.items);
      setMeta(res.meta);
    } catch {
      // Handle error silently
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFavorites(page);
  }, [page, fetchFavorites]);

  const handleRemoveFavorite = async (vehicleId: string) => {
    try {
      await me.removeFavorite(vehicleId);
      setFavorites((prev) => prev.filter((v) => v.id !== vehicleId));
      if (meta) {
        setMeta({ ...meta, total: meta.total - 1 });
      }
    } catch {
      // Handle error silently
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-fg font-display">Обране</h1>

      {favorites.length === 0 ? (
        <div className="bg-white border border-border rounded-lg p-12 text-center">
          <Heart className="w-12 h-12 text-fg-subtle mx-auto mb-4" />
          <p className="text-fg-muted mb-4">У вас немає обраних авто</p>
          <p className="text-fg-subtle text-sm mb-6">
            Натисніть серце на картці авто в каталозі, щоб додати його сюди
          </p>
          <Link
            href="/catalog"
            className="inline-block px-6 py-2.5 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-sm transition-colors"
          >
            Переглянути каталог
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {favorites.map((vehicle) => {
              const primaryImage = vehicle.media?.find((m: any) => m.isPrimary) || vehicle.media?.[0];
              const imgUrl = primaryImage?.sourceUrl || primaryImage?.url;
              return (
                <div
                  key={vehicle.id}
                  className="bg-white border border-border rounded-lg overflow-hidden group"
                >
                  <div className="relative h-48 bg-background flex items-center justify-center">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={`${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Car className="w-10 h-10 text-fg-subtle" />
                    )}
                    <button
                      onClick={() => handleRemoveFavorite(vehicle.id)}
                      className="absolute top-3 right-3 w-9 h-9 bg-red-500/90 rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                      title="Видалити з обраного"
                    >
                      <Heart className="w-5 h-5 text-white fill-white" />
                    </button>
                  </div>
                  <Link href={`/catalog/${vehicle.slug}`} className="block p-4">
                    <h3 className="text-fg font-semibold">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </h3>
                    {(vehicle.odometerValue || vehicle.odometer) && (
                      <p className="text-fg-muted text-sm mt-1">
                        {(vehicle.odometerValue || vehicle.odometer)!.toLocaleString()} км
                      </p>
                    )}
                    <p className="text-green-600 font-bold text-lg mt-2">
                      ${Number(vehicle.priceAmount).toLocaleString()}
                    </p>
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-white border border-border text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-fg-muted text-sm px-4">
                {page} / {meta.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                disabled={page >= meta.totalPages}
                className="p-2 rounded-lg bg-white border border-border text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
