'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send, Loader2, CheckCircle } from 'lucide-react';
import type { LeadType } from '@/lib/types';

const leadSchema = z.object({
  name: z.string().min(2, 'Мінімум 2 символи'),
  phone: z
    .string()
    .min(10, 'Введіть коректний номер телефону')
    .regex(/^[\d\s\+\-\(\)]+$/, 'Невірний формат телефону'),
  email: z.union([z.string().email('Невірний email'), z.literal('')]).optional(),
  comment: z.string().max(1000, 'Максимум 1000 символів').optional(),
});

type LeadFormValues = z.infer<typeof leadSchema>;

interface LeadFormProps {
  leadType?: LeadType;
  vehicleId?: string;
  calculatorEstimateId?: string;
  onSuccess?: () => void;
}

const inputClass =
  'w-full bg-white border border-border-strong rounded-sm px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30 transition-colors';
const labelClass = 'block text-sm font-medium text-fg mb-1.5';
const errorMsgClass = 'text-xs text-red-500 mt-1';

export function LeadForm({
  leadType = 'CONTACT_FORM',
  vehicleId,
  calculatorEstimateId,
  onSuccess,
}: LeadFormProps) {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
  });

  async function onSubmit(data: LeadFormValues) {
    setIsLoading(true);
    setError(null);

    try {
      const { leads } = await import('@/lib/api');
      await leads.create({
        leadType,
        name: data.name,
        phone: data.phone,
        email: data.email || undefined,
        comment: data.comment || undefined,
        vehicleId,
        calculatorEstimateId,
      });
      setIsSubmitted(true);
      onSuccess?.();
    } catch {
      setError('Не вдалося надіслати заявку. Спробуйте пізніше.');
    } finally {
      setIsLoading(false);
    }
  }

  if (isSubmitted) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center animate-fade-in">
        <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
        <h3 className="text-lg font-semibold text-fg mb-2">Дякуємо!</h3>
        <p className="text-sm text-fg-muted">
          Ми зв&#39;яжемося з вами найближчим часом.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={labelClass}>
          Ім&#39;я <span className="text-red-500">*</span>
        </label>
        <input type="text" placeholder="Ваше ім'я" {...register('name')} className={inputClass} />
        {errors.name && <p className={errorMsgClass}>{errors.name.message}</p>}
      </div>

      <div>
        <label className={labelClass}>
          Телефон <span className="text-red-500">*</span>
        </label>
        <input type="tel" placeholder="+380 XX XXX XX XX" {...register('phone')} className={inputClass} />
        {errors.phone && <p className={errorMsgClass}>{errors.phone.message}</p>}
      </div>

      <div>
        <label className={labelClass}>
          Email <span className="text-fg-subtle">(опціонально)</span>
        </label>
        <input type="email" placeholder="email@example.com" {...register('email')} className={inputClass} />
        {errors.email && <p className={errorMsgClass}>{errors.email.message}</p>}
      </div>

      <div>
        <label className={labelClass}>
          Коментар <span className="text-fg-subtle">(опціонально)</span>
        </label>
        <textarea
          rows={4}
          placeholder="Додатковий коментар або побажання..."
          {...register('comment')}
          className={`${inputClass} resize-none`}
        />
        {errors.comment && <p className={errorMsgClass}>{errors.comment.message}</p>}
      </div>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-sm px-4 py-3">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm transition-colors"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Надіслати заявку
      </button>
    </form>
  );
}
