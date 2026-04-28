'use client';

import { useState, useMemo } from 'react';
import { Calculator, Loader2, Truck } from 'lucide-react';

const fuelTypeOptions = [
  { value: 'gasoline', label: 'Бензин' },
  { value: 'diesel', label: 'Дизель' },
  { value: 'electric', label: 'Електро' },
  { value: 'hybrid', label: 'Гібрид' },
];

const carTypeOptions = [
  { value: 'auction', label: 'Аукціон (США)' },
  { value: 'ukraine', label: 'В Україні' },
];

const engineVolumeOptions = [
  { value: 1.6, label: 'До 2.0 л' },
  { value: 2.5, label: '2.0 – 3.0 л' },
  { value: 3.5, label: 'Понад 3.0 л' },
];

const yearOptions = [
  { value: 2024, label: '2024' },
  { value: 2023, label: '2023' },
  { value: 2022, label: '2022' },
  { value: 2021, label: '2021' },
  { value: 2020, label: '2020' },
  { value: 2019, label: '2019' },
  { value: 2018, label: '2018' },
  { value: 2015, label: '2015' },
  { value: 2010, label: '2010' },
];

function formatUSD(amount: number): string {
  return '$' + amount.toLocaleString('uk-UA');
}

// Auction fee based on final bid (Copart-style tiers)
function getAuctionFee(price: number): number {
  if (price <= 5000) return 450;
  if (price <= 10000) return 575;
  if (price <= 15000) return 650;
  if (price <= 20000) return 725;
  if (price <= 25000) return 800;
  if (price <= 30000) return 850;
  if (price <= 40000) return 1000;
  return 1200;
}

// Customs duty calculation (Ukrainian rules simplified)
function getCustomsDuty(
  price: number,
  fuelType: string,
  engineVolume: number,
  year: number,
): { duty: number; excise: number; vat: number } {
  const age = new Date().getFullYear() - year;

  if (fuelType === 'electric') {
    // Electric vehicles: 0% duty, 0 excise, 20% VAT
    const duty = 0;
    const excise = 0;
    const vat = Math.round((price + duty + excise) * 0.2);
    return { duty, excise, vat };
  }

  // Import duty 10%
  const duty = Math.round(price * 0.1);

  // Excise tax (EUR per cm³) — simplified
  let exciseRate: number;
  if (fuelType === 'diesel') {
    exciseRate = age <= 5 ? 75 : age <= 10 ? 150 : 200;
  } else {
    // gasoline / hybrid
    exciseRate = age <= 5 ? 50 : age <= 10 ? 100 : 150;
  }
  // EUR rate ~42 UAH, convert to USD (~1 EUR = 1.08 USD)
  const excise = Math.round((engineVolume * exciseRate) / 100);

  // VAT 20% on (price + duty + excise)
  const vat = Math.round((price + duty + excise) * 0.2);

  return { duty, excise, vat };
}

export function CalculatorForm() {
  const [price, setPrice] = useState(15000);
  const [carType, setCarType] = useState('auction');
  const [fuelType, setFuelType] = useState('gasoline');
  const [engineVolume, setEngineVolume] = useState(1.6);
  const [year, setYear] = useState(2022);
  const [calculated, setCalculated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const result = useMemo(() => {
    if (!calculated) return null;

    const isAuction = carType === 'auction';
    const auctionFee = isAuction ? getAuctionFee(price) : 0;
    const shipping = isAuction ? 1800 : 0; // US port to UA
    const inlandDelivery = isAuction ? 300 : 0; // US inland
    const insurance = isAuction ? Math.round(price * 0.015) : 0;
    const { duty, excise, vat } = getCustomsDuty(price, fuelType, engineVolume * 1000, year);
    const brokerFee = 200;
    const serviceFee = 500;

    const lines = [
      { label: 'Вартість авто', amount: price },
      ...(isAuction ? [{ label: 'Аукціонний збір', amount: auctionFee }] : []),
      ...(isAuction ? [{ label: 'Доставка по США', amount: inlandDelivery }] : []),
      ...(isAuction ? [{ label: 'Морський фрахт US→UA', amount: shipping }] : []),
      ...(isAuction ? [{ label: 'Страхування', amount: insurance }] : []),
      { label: 'Ввізне мито (10%)', amount: duty },
      { label: 'Акцизний збір', amount: excise },
      { label: 'ПДВ (20%)', amount: vat },
      { label: 'Брокер', amount: brokerFee },
      { label: 'Сервіс Strong Auto', amount: serviceFee },
    ].filter((l) => l.amount > 0);

    const total = lines.reduce((sum, l) => sum + l.amount, 0);

    return { lines, total };
  }, [calculated, price, carType, fuelType, engineVolume, year]);

  function handleCalculate() {
    setIsLoading(true);
    // Small delay for UX
    setTimeout(() => {
      setCalculated(true);
      setIsLoading(false);
    }, 400);
  }

  // Recalculate on param change if already calculated
  function updateAndRecalc<T>(setter: (v: T) => void, value: T) {
    setter(value);
    if (calculated) {
      // Trigger recalc on next render
      setCalculated(false);
      setTimeout(() => setCalculated(true), 0);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-4">
      {/* Left: Form */}
      <div>
        <div className="eyebrow mb-2">БЕЗКОШТОВНИЙ РОЗРАХУНОК</div>
        <h2 className="font-display font-bold text-fg leading-tight mb-1 text-2xl sm:text-3xl">
          Розрахуйте вартість авто за 30 секунд
        </h2>
        <p className="text-sm text-fg-muted mb-6">
          Отримайте орієнтовну ціну з урахуванням доставки та розмитнення.
        </p>

        {/* Price slider */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-fg">$ Вартість авто</label>
            <span className="inline-flex items-center bg-white border-2 border-green-500 text-green-500 font-bold text-base px-2.5 py-0.5 rounded-xs">
              {formatUSD(price)}
            </span>
          </div>
          <input
            type="range"
            min={1000}
            max={80000}
            step={500}
            value={price}
            onChange={(e) => updateAndRecalc(setPrice, Number(e.target.value))}
            className="w-full accent-green-500"
          />
          <div className="flex justify-between text-xs text-fg-subtle mt-1">
            <span>$1 000</span>
            <span>$80 000</span>
          </div>
        </div>

        {/* Car type chips */}
        <div className="mb-4">
          <label className="text-sm font-medium text-fg mb-2 flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" /> Тип авто
          </label>
          <div className="flex flex-wrap gap-2">
            {carTypeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateAndRecalc(setCarType, opt.value)}
                className={`text-[13px] font-semibold px-3.5 py-2 rounded-sm transition-colors ${
                  carType === opt.value
                    ? 'bg-navy-800 text-white'
                    : 'bg-white text-fg border border-border-strong hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fuel type chips */}
        <div className="mb-4">
          <label className="text-sm font-medium text-fg mb-2 block">Тип пального</label>
          <div className="flex flex-wrap gap-2">
            {fuelTypeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateAndRecalc(setFuelType, opt.value)}
                className={`text-[13px] font-semibold px-3.5 py-2 rounded-sm transition-colors ${
                  fuelType === opt.value
                    ? 'bg-green-500 text-white'
                    : 'bg-white text-fg border border-border-strong hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Engine volume chips */}
        {fuelType !== 'electric' && (
          <div className="mb-4">
            <label className="text-sm font-medium text-fg mb-2 block">
              Об&apos;єм двигуна
            </label>
            <div className="flex flex-wrap gap-2">
              {engineVolumeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateAndRecalc(setEngineVolume, opt.value)}
                  className={`text-[13px] font-semibold px-3.5 py-2 rounded-sm transition-colors ${
                    engineVolume === opt.value
                      ? 'bg-green-500 text-white'
                      : 'bg-white text-fg border border-border-strong hover:bg-background'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Year */}
        <div className="mb-5">
          <label className="text-sm font-medium text-fg mb-2 block">Рік випуску</label>
          <div className="flex flex-wrap gap-2">
            {yearOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateAndRecalc(setYear, opt.value)}
                className={`text-[13px] font-semibold px-3 py-1.5 rounded-sm transition-colors ${
                  year === opt.value
                    ? 'bg-green-500 text-white'
                    : 'bg-white text-fg border border-border-strong hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCalculate}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white py-3.5 rounded-sm font-bold text-sm disabled:opacity-50 transition-colors"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
          Розрахувати вартість
        </button>
      </div>

      {/* Right: Result */}
      <div className="bg-navy-800 text-white rounded-lg p-6 sm:p-8 flex flex-col items-center justify-center min-h-[300px]">
        {result ? (
          <div className="w-full animate-fade-in">
            <h3 className="font-display font-bold text-xl mb-1">Орієнтовна вартість</h3>
            <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {carType === 'auction' ? 'З доставкою з США в Україну' : 'Авто в Україні'}
            </p>
            <div className="space-y-0">
              {result.lines.map((line, i) => (
                <div
                  key={i}
                  className="flex justify-between text-[13px] py-2"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>{line.label}</span>
                  <span className="font-semibold">{formatUSD(line.amount)}</span>
                </div>
              ))}
            </div>
            <div
              className="flex justify-between font-display font-bold mt-3 pt-3"
              style={{ borderTop: '2px solid rgba(255,255,255,0.2)', fontSize: 22 }}
            >
              <span>Загалом</span>
              <span className="text-green-400">{formatUSD(result.total)}</span>
            </div>
            <p className="text-[11px] mt-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
              * Розрахунок є орієнтовним. Фінальна вартість може відрізнятись залежно від курсу валют та індивідуальних умов.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-navy-700 flex items-center justify-center mx-auto mb-4">
              <Truck className="h-8 w-8 text-navy-400" />
            </div>
            <h3 className="font-display font-bold text-xl mb-2">Розрахунок</h3>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Заповніть форму
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Виберіть параметри авто та натисніть кнопку розрахувати, щоб побачити детальну оцінку вартості
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
