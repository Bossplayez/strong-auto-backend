'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Heart, Loader2, X, Gavel, Clock } from 'lucide-react';
import api from '@/lib/api';
import type { Vehicle, VehicleMedia } from '@/lib/types';
import { StatusTag } from '@/components/StatusTag';
import { PriceTag } from '@/components/PriceTag';
import { LeadForm } from '@/components/LeadForm';
import { useAuth } from '@/hooks/useAuth';

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
  const [bidAmount, setBidAmount] = useState('');
  const [bidLoading, setBidLoading] = useState(false);
  const [bidMessage, setBidMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [bidHistory, setBidHistory] = useState<Array<{ id: string; amount: number; bidder: string; createdAt: string }>>([]);
  const [currentBid, setCurrentBid] = useState<number | null>(null);
  const [totalBids, setTotalBids] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const { isAuthenticated, login, register: registerUser } = useAuth();

  const fetchBids = useCallback(async (vehicleId: string) => {
    try {
      const data = await api.catalog.getVehicleBids(vehicleId);
      setBidHistory(data.bids);
      setCurrentBid(data.currentBidAmount);
      setTotalBids(data.totalBids);
    } catch {
      // ignore
    }
  }, []);

  const handlePlaceBid = async () => {
    if (!vehicle || !bidAmount) return;
    setBidLoading(true);
    setBidMessage(null);
    try {
      const result = await api.catalog.placeBid(vehicle.id, Number(bidAmount.replace(/\s/g, '')));
      setBidMessage({ type: 'success', text: result.message });
      setCurrentBid(result.amount);
      setBidAmount('');
      fetchBids(vehicle.id);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Не вдалося зробити ставку';
      setBidMessage({ type: 'error', text: msg });
    } finally {
      setBidLoading(false);
    }
  };

  const handleAuth = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode === 'login') {
        await login(authEmail, authPassword);
      } else {
        await registerUser(authEmail, authPassword, authPhone || undefined);
      }
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthPhone('');
    } catch {
      setAuthError(authMode === 'login' ? 'Невірний email або пароль' : 'Помилка реєстрації. Можливо, цей email вже зареєстровано.');
    } finally {
      setAuthLoading(false);
    }
  };

  const toggleFavorite = async () => {
    if (!vehicle || !isAuthenticated || favLoading) return;
    setFavLoading(true);
    try {
      if (isFavorite) {
        await api.me.removeFavorite(vehicle.id);
        setIsFavorite(false);
      } else {
        await api.me.addFavorite(vehicle.id);
        setIsFavorite(true);
      }
    } catch {
      // ignore
    } finally {
      setFavLoading(false);
    }
  };

  // SEO: dynamic meta tags
  useEffect(() => {
    if (!vehicle) return;
    const seoTitle = `${vehicle.make} ${vehicle.model} ${vehicle.year} — купити в Україні | Strong Auto`;
    const seoDesc = `${vehicle.make} ${vehicle.model} ${vehicle.year}, ${vehicle.fuelType || ''}, ${vehicle.odometerValue ? vehicle.odometerValue.toLocaleString() + ' км' : ''}, $${Number(vehicle.priceAmount).toLocaleString()}. Доставка та розмитнення під ключ.`;
    document.title = seoTitle;
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.setAttribute('name', 'description'); document.head.appendChild(metaDesc); }
    metaDesc.setAttribute('content', seoDesc);
    // Open Graph
    const ogTags: Record<string, string> = { 'og:title': seoTitle, 'og:description': seoDesc, 'og:type': 'product' };
    const primaryImg = vehicle.media?.find((m) => m.isPrimary);
    if (primaryImg?.sourceUrl || primaryImg?.url) ogTags['og:image'] = (primaryImg.sourceUrl || primaryImg.url)!;
    Object.entries(ogTags).forEach(([prop, content]) => {
      let el = document.querySelector(`meta[property="${prop}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
      el.setAttribute('content', content);
    });
  }, [vehicle]);

  useEffect(() => {
    async function fetchVehicle() {
      if (!params.slug) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.catalog.getVehicle(params.slug);
        setVehicle(data);
        const primary = data.media?.find((m: VehicleMedia) => m.isPrimary);
        setSelectedImage(primary?.sourceUrl ?? primary?.url ?? data.media?.[0]?.sourceUrl ?? data.media?.[0]?.url ?? null);
        if (data.sourceType === 'COPART') {
          fetchBids(data.id);
        }
      } catch {
        setError('Не вдалося завантажити інформацію про автомобіль.');
      } finally {
        setLoading(false);
      }
    }
    fetchVehicle();
  }, [params.slug, fetchBids]);

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
    ['Двигун', vehicle.specs?.engineVolume || vehicle.fuelType || null],
    ['Пробіг', (vehicle.odometerValue || vehicle.odometer) ? `${(vehicle.odometerValue || vehicle.odometer)!.toLocaleString()} км` : null],
    ['Привід', vehicle.driveType],
    ['Коробка передач', vehicle.transmission],
    ['Колір', vehicle.specs?.color],
    ['Тип палива', vehicle.fuelType],
    ['Кузов', vehicle.bodyType],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div>
      <div className="px-4 sm:px-6 max-w-container mx-auto" style={{ paddingTop: 16, paddingBottom: 32 }}>
        {/* Breadcrumb */}
        <Link href="/catalog" className="text-[13px] text-fg-muted hover:text-fg cursor-pointer">
          &larr; {isAuction ? 'Аукціон США' : 'Усі авто в Україні'}
        </Link>

        {/* Title row */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mt-3 mb-5 gap-2 sm:gap-4">
          <div>
            <StatusTag variant={isAuction ? 'green' : 'default'}>{statusLabel}</StatusTag>
            <h1 className="font-display font-bold text-fg leading-none mt-1.5 text-2xl sm:text-4xl lg:text-[48px]">
              {title}
            </h1>
            {vehicle.vin && (
              <div className="text-[12px] sm:text-[13px] text-fg-muted font-mono mt-1.5 break-all">
                VIN &middot; {vehicle.vin}
                {vehicle.specs?.lotNumber && <> &middot; LOT {vehicle.specs.lotNumber}</>}
              </div>
            )}
          </div>
          {!isAuction && <PriceTag value={vehicle.priceAmount} size="lg" />}
        </div>

        {/* Main grid: 2fr image + 1fr sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          {/* LEFT: Image + specs */}
          <div>
            {/* Main image */}
            <div className="rounded-lg overflow-hidden relative bg-gray-200" style={{ height: 'clamp(220px, 50vw, 380px)' }}>
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
                    onClick={() => setSelectedImage(media.sourceUrl ?? media.url ?? null)}
                    className={`rounded-xs overflow-hidden border-2 transition ${
                      selectedImage === (media.sourceUrl || media.url) ? 'border-green-500' : 'border-transparent hover:border-border-strong'
                    }`}
                    style={{ background: 'var(--navy-700)', height: 56 }}
                  >
                    <Image src={media.sourceUrl || media.url || ''} alt={title} width={120} height={56} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Specs card */}
            <div className="bg-white rounded-lg p-6 mt-4">
              <h2 className="font-display font-bold text-fg mb-4" style={{ fontSize: 24 }}>
                Характеристики
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0">
                {specs.map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center py-3 border-b border-border gap-4">
                    <span className="text-[13px] text-fg-muted whitespace-nowrap">{label}</span>
                    <span className="text-[13px] font-semibold text-fg text-right">{value}</span>
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
                <div className="bg-white rounded-lg p-5 sm:p-6">
                  <div className="eyebrow mb-1">Поточна ставка</div>
                  <div className="font-display font-bold text-green-500 text-3xl sm:text-4xl lg:text-[48px]">
                    ${(currentBid ?? Number(vehicle.priceAmount)).toLocaleString('uk-UA')}
                  </div>
                  <div className="flex items-center gap-3 text-[13px] text-fg-muted mb-4">
                    <span>мінімальний крок $100</span>
                    {totalBids > 0 && (
                      <span className="flex items-center gap-1">
                        <Gavel className="h-3 w-3" /> {totalBids} {totalBids === 1 ? 'ставка' : totalBids < 5 ? 'ставки' : 'ставок'}
                      </span>
                    )}
                  </div>

                  {isAuthenticated ? (
                    <>
                      <div className="mb-3">
                        <label className="text-xs font-bold mb-1.5 block">Ваша ставка, $</label>
                        <input
                          type="number"
                          value={bidAmount}
                          onChange={(e) => setBidAmount(e.target.value)}
                          placeholder={String((currentBid ?? Number(vehicle.priceAmount)) + 100)}
                          min={(currentBid ?? Number(vehicle.priceAmount)) + 100}
                          step={100}
                          className="w-full h-11 px-3.5 rounded-sm border border-border-strong font-semibold text-[15px] focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30"
                        />
                      </div>

                      {bidMessage && (
                        <div className={`text-sm px-3 py-2 rounded-sm mb-3 ${
                          bidMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'
                        }`}>
                          {bidMessage.text}
                        </div>
                      )}

                      <button
                        onClick={handlePlaceBid}
                        disabled={bidLoading || !bidAmount}
                        className="w-full bg-green-500 hover:bg-green-600 text-white py-3.5 rounded-sm font-bold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {bidLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}
                        Зробити ставку
                      </button>
                    </>
                  ) : (
                    <div>
                      <button
                        onClick={() => { setShowAuthModal(true); setAuthMode('login'); }}
                        className="w-full bg-green-500 hover:bg-green-600 text-white py-3.5 rounded-sm font-bold text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <Gavel className="h-4 w-4" /> Увійдіть щоб зробити ставку
                      </button>
                      <button
                        onClick={() => { setShowAuthModal(true); setAuthMode('register'); }}
                        className="w-full mt-2 text-sm text-fg-muted hover:text-green-600 transition-colors text-center"
                      >
                        Немає акаунту? <span className="text-green-600 font-semibold">Зареєструватися</span>
                      </button>
                    </div>
                  )}

                  <button
                    onClick={toggleFavorite}
                    disabled={favLoading || !isAuthenticated}
                    className={`w-full mt-2 border py-3 rounded-sm font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
                      isFavorite
                        ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                        : 'bg-white text-fg border-border-strong hover:bg-background'
                    }`}
                  >
                    <Heart className={`h-4 w-4 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                    {isFavorite ? 'В обраному' : 'Додати в обране'}
                  </button>
                </div>

                {/* Bid history */}
                {bidHistory.length > 0 && (
                  <div className="bg-white rounded-lg p-5">
                    <div className="text-sm font-bold text-fg mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4" /> Історія ставок
                    </div>
                    <div className="space-y-0">
                      {bidHistory.slice(0, 5).map((bid) => (
                        <div key={bid.id} className="flex justify-between items-center text-[13px] py-2 border-b border-border last:border-0">
                          <div>
                            <span className="font-medium text-fg">{bid.bidder}</span>
                            <span className="text-fg-muted ml-2">
                              {new Date(bid.createdAt).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <span className="font-bold text-green-600">${bid.amount.toLocaleString('uk-UA')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cost breakdown */}
                {(() => {
                  const price = currentBid ?? Number(vehicle.priceAmount);
                  const auctionFee = price <= 15000 ? 650 : price <= 25000 ? 800 : price <= 40000 ? 1000 : 1200;
                  const shipping = 2100;
                  const customs = Math.round(price * 0.1 + price * 0.2);
                  const service = 500;
                  const total = price + auctionFee + shipping + customs + service;
                  return (
                    <div className="bg-navy-800 text-white rounded-lg p-4 sm:p-5">
                      <div className="eyebrow mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        Загальна вартість
                      </div>
                      <div className="font-display font-bold mb-3.5 text-base sm:text-lg">
                        З доставкою у Київ
                      </div>
                      {[
                        ['Ставка', `$${price.toLocaleString('uk-UA')}`],
                        ['Аукціонні збори', `$${auctionFee.toLocaleString('uk-UA')}`],
                        ['Доставка US→UA', `$${shipping.toLocaleString('uk-UA')}`],
                        ['Розмитнення + ПДВ', `$${customs.toLocaleString('uk-UA')}`],
                        ['Сервіс', `$${service.toLocaleString('uk-UA')}`],
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
                        <span className="text-green-400">${total.toLocaleString('uk-UA')}</span>
                      </div>
                    </div>
                  );
                })()}
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
                <button
                  onClick={toggleFavorite}
                  disabled={favLoading || !isAuthenticated}
                  className={`border py-3 rounded-sm font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
                    isFavorite
                      ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                      : 'bg-white text-fg border-border-strong hover:bg-background'
                  }`}
                >
                  <Heart className={`h-4 w-4 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                  {isFavorite ? 'В обраному' : 'Додати в обране'}
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

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm mx-4 relative">
            <button
              onClick={() => { setShowAuthModal(false); setAuthError(null); }}
              className="absolute top-3 right-3 p-1 text-fg-muted hover:text-fg rounded"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="font-display font-bold text-fg text-xl mb-1">
              {authMode === 'login' ? 'Увійти' : 'Реєстрація'}
            </h2>
            <p className="text-sm text-fg-muted mb-4">
              {authMode === 'login' ? 'Щоб зробити ставку на аукціоні' : 'Створіть акаунт за 10 секунд'}
            </p>

            {authError && (
              <div className="mb-3 p-2.5 rounded-sm bg-red-50 border border-red-200 text-red-600 text-sm">
                {authError}
              </div>
            )}

            <div className="space-y-3">
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Email"
                className="w-full px-3.5 py-2.5 bg-white border border-border-strong rounded-sm text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30"
              />
              {authMode === 'register' && (
                <input
                  type="tel"
                  value={authPhone}
                  onChange={(e) => setAuthPhone(e.target.value)}
                  placeholder="Телефон (необов'язково)"
                  className="w-full px-3.5 py-2.5 bg-white border border-border-strong rounded-sm text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30"
                />
              )}
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder={authMode === 'login' ? 'Пароль' : 'Пароль (мін. 6 символів)'}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                className="w-full px-3.5 py-2.5 bg-white border border-border-strong rounded-sm text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30"
              />
              <button
                onClick={handleAuth}
                disabled={authLoading || !authEmail || !authPassword}
                className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-sm font-bold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {authLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {authMode === 'login' ? 'Увійти' : 'Зареєструватися'}
              </button>
            </div>

            <div className="mt-4 text-center">
              <button
                onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(null); }}
                className="text-sm text-fg-muted hover:text-fg transition-colors"
              >
                {authMode === 'login'
                  ? <>Немає акаунту? <span className="text-green-600 font-semibold">Зареєструватися</span></>
                  : <>Вже є акаунт? <span className="text-green-600 font-semibold">Увійти</span></>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
