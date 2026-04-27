'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, Mail, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const loginSchema = z.object({
  email: z.string().email('Невірний формат email'),
  password: z.string().min(1, 'Пароль обов\'язковий'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setError(null);
    try {
      await login(data.email, data.password);
      router.push('/dashboard');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Невірний email або пароль';
      setError(message);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-border rounded-lg p-8">
        <div className="flex items-center justify-center mb-6">
          <LogIn className="w-8 h-8 text-green-500 mr-2" />
          <h1 className="text-2xl font-display font-bold text-fg">Увійти</h1>
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
              <input
                type="email"
                {...register('email')}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-border-strong rounded-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-green-500 transition-colors text-[13px]"
                placeholder="your@email.com"
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-fg mb-1">Пароль</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
              <input
                type="password"
                {...register('password')}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-border-strong rounded-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-green-500 transition-colors text-[13px]"
                placeholder="********"
              />
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
            {isSubmitting ? 'Завантаження...' : 'Увійти'}
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <Link
            href="/forgot-password"
            className="block text-sm text-fg-muted hover:text-green-600 transition-colors"
          >
            Забули пароль?
          </Link>
          <Link
            href="/register"
            className="block text-sm text-fg-muted hover:text-green-600 transition-colors"
          >
            Немає акаунту? <span className="text-green-600 font-semibold">Зареєструватися</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
