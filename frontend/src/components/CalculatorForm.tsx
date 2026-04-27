'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Calculator, Loader2, Truck } from 'lucide-react';
import type { CalculatorBreakdown } from '@/lib/types';

const calculatorSchema = z.object({
  priceAmount: z.number({ invalid_type_error: 'Введіть ціну' }).min(1, 'Мінімальна ціна — $1'),
  fuelType: z.string().min(1, 'Оберіть тип палива'),
  engineVolume: z.number({ invalid_type_error: 'Введіть обʼєм' }).min(0, 'Мінімум 0'),
  year: z
    .number({ invalid_type_error: 'Введіть рік' })
    .min(1990, 'Мінімальний рік — 1990')
    .max(new Date().getFullYear() + 1, 'Невірний рік'),
  sourceCountry: z.string().optional(),
  destinationCity: z.string().optional(),
});

type CalculatorFormValues = z.infer<typeof calculatorSchema>;

const fuelTypeOptions = [
  { value: 'gasoline', label: 'Бензин' },
  { value: 'diesel', label: 'Дизель' },
  { value: 'electric', label: 'Електро' },
  { value: 'hybrid', label: 'Гібрид' },
];

const carTypeOptions = [
  { value: 'auction', label: 'Аукціон (США)' },
  { value: 'ukraine', label: 'В Україні' },
  { value: 'transit', label: 'В дорозі' },
];

const engineVolumeOptions = [
  { value: 'small', label: 'До 2.0 л' },
  { value: 'medium', label: '2.0 – 3.0 л' },
  { value: 'large', label: 'Понад 3.0 л' },
];

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

const inputClass =
  'w-full bg-white border border-border-strong rounded-sm px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30 transition-colors';
const labelClass = 'block text-sm font-medium text-fg mb-1.5';
const errorClass = 'text-xs text-red-500 mt-1';

export function CalculatorForm() {
  const [result, setResult] = useState<CalculatorBreakdown | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceSlider, setPriceSlider] = useState(15000);
  const [activeCarType, setActiveCarType] = useState('auction');
  const [activeFuel, setActiveFuel] = useState('gasoline');
  const [activeEngine, setActiveEngine] = useState('small');

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CalculatorFormValues>({
    resolver: zodResolver(calculatorSchema),
    defaultValues: {
      priceAmount: 15000,
      fuelType: 'gasoline',
      engineVolume: 2.0,
      year: new Date().getFullYear(),
    },
  });

  async function onSubmit(data: CalculatorFormValues) {
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const { default: axios } = await import('axios');
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api';
      const response = await axios.post(`${apiBase}/calculator/estimate`, {
        priceAmount: data.priceAmount,
        currency: 'USD',
        fuelType: data.fuelType,
        engineVolume: data.engineVolume,
        year: data.year,
        sourceCountry: data.sourceCountry || undefined,
        destinationCity: data.destinationCity || undefined,
      });
      setResult(response.data);
    } catch {
      setError('Не вдалося виконати розрахунок. Спробуйте пізніше.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Left: Form */}
      <div>
        <div className="eyebrow mb-2">БЕЗКОШТОВНИЙ РОЗРАХУНОК</div>
        <h2 className="font-display font-bold text-fg leading-tight mb-1" style={{ fontSize: 36 }}>
          Розрахуйте вартість авто за 30 секунд
        </h2>
        <p className="text-sm text-fg-muted mb-6">
          Отримайте орієнтовну ціну з урахуванням доставки та розмитнення.
        </p>

        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Price slider */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-fg">$ Вартість авто</label>
              <span className="inline-flex items-center bg-white border-2 border-green-500 text-green-500 font-bold text-base px-2 py-0.5 rounded-xs">
                ${priceSlider.toLocaleString().replace(/,/g, ' ')}
              </span>
            </div>
            <input
              type="range"
              min={1000}
              max={50000}
              step={500}
              value={priceSlider}
              onChange={(e) => {
                const val = Number(e.target.value);
                setPriceSlider(val);
                setValue('priceAmount', val);
              }}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-fg-subtle mt-1">
              <span>$1,000</span>
              <span>$50,000</span>
            </div>
          </div>

          {/* Car type chips */}
          <div className="mb-4">
            <label className="text-sm font-medium text-fg mb-2 flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" /> Тип авто
            </label>
            <div className="flex gap-2">
              {carTypeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setActiveCarType(opt.value)}
                  className={`text-[13px] font-semibold px-3.5 py-2 rounded-sm transition-colors ${
                    activeCarType === opt.value
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
            <label className="text-sm font-medium text-fg mb-2 flex items-center gap-1.5">
              Тип пального
            </label>
            <div className="flex gap-2">
              {fuelTypeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setActiveFuel(opt.value);
                    setValue('fuelType', opt.value);
                  }}
                  className={`text-[13px] font-semibold px-3.5 py-2 rounded-sm transition-colors ${
                    activeFuel === opt.value
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
          <div className="mb-5">
            <label className="text-sm font-medium text-fg mb-2 flex items-center gap-1.5">
              Об&apos;єм двигуна
            </label>
            <div className="flex gap-2">
              {engineVolumeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setActiveEngine(opt.value);
                    const vol = opt.value === 'small' ? 1.6 : opt.value === 'medium' ? 2.5 : 3.5;
                    setValue('engineVolume', vol);
                  }}
                  className={`text-[13px] font-semibold px-3.5 py-2 rounded-sm transition-colors ${
                    activeEngine === opt.value
                      ? 'bg-green-500 text-white'
                      : 'bg-white text-fg border border-border-strong hover:bg-background'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-sm px-4 py-3 mb-4">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white py-3.5 rounded-sm font-bold text-sm disabled:opacity-50 transition-colors"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            Розрахувати вартість
          </button>
        </form>
      </div>

      {/* Right: Result */}
      <div className="bg-navy-800 text-white rounded-lg p-8 flex flex-col items-center justify-center">
        {result ? (
          <div className="w-full animate-fade-in">
            <h3 className="font-display font-bold text-xl mb-4">Розрахунок</h3>
            <div className="space-y-2">
              {result.lines.map((line, i) => (
                <div key={i} className="flex justify-between text-[13px] py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>{line.label}</span>
                  <span className="font-semibold">{formatCurrency(line.amount, line.currency)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between font-display font-bold mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.2)', fontSize: 22 }}>
              <span>Загалом</span>
              <span className="text-green-400">{formatCurrency(result.totalAmount, result.totalCurrency)}</span>
            </div>
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
