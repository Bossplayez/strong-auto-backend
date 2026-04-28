'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus, Mail, Lock, Phone, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const registerSchema = z.object({
  email: z.string().email('Невірний формат email'),
  phone: z.string().optional(),
  password: z.string().min(6, 'Пароль має містити мінімум 6 символів'),
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerUser } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    setError(null);
    try {
      await registerUser(data.email, data.password, data.phone || undefined);
      router.push('/dashboard');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Помилка при реєстрації';
      setError(message);
    }
  };

  const inputClass = "w-full pl-10 pr-4 py-2.5 bg-white border border-border-strong rounded-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-green-500 transition-colors text-[13px]";

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-border rounded-lg p-8">
        <div className="flex items-center justify-center mb-6">
          <UserPlus className="w-8 h-8 text-green-500 mr-2" />
          <h1 className="text-2xl font-display font-bold text-fg">Реєстрація</h1>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-fg mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
              <input type="email" {...register('email')} className={inputClass} placeholder="your@email.com" />
            </div>
            {errors.email && (
              <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-fg mb-1">
              Телефон <span className="text-fg-subtle font-normal">(необов&apos;язково)</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
              <input type="tel" {...register('phone')} className={inputClass} placeholder="+380 XX XXX XX XX" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-fg mb-1">Пароль</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
              <input type="password" {...register('password')} className={inputClass} placeholder="Мінімум 6 символів" />
            </div>
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-sm transition-colors text-[13px]"
          >
            {isSubmitting ? 'Завантаження...' : 'Зареєструватися'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="text-sm text-fg-muted hover:text-green-600 transition-colors"
          >
            Вже є акаунт? <span className="text-green-600 font-semibold">Увійти</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
