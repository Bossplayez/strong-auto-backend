'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { auth } from '@/lib/api';

const forgotPasswordSchema = z.object({
  email: z.string().email('Невірний формат email'),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setError(null);
    try {
      await auth.forgotPassword(data.email);
      setSuccess(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Помилка при відправці листа';
      setError(message);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-border rounded-lg p-8">
        <div className="flex items-center justify-center mb-6">
          <KeyRound className="w-8 h-8 text-green-500 mr-2" />
          <h1 className="text-2xl font-display font-bold text-fg">Відновлення паролю</h1>
        </div>

        {success ? (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <CheckCircle2 className="w-16 h-16 text-green-500" />
            </div>
            <p className="text-fg text-lg font-bold">Перевірте вашу пошту</p>
            <p className="text-fg-muted text-sm">
              Ми надіслали посилання для відновлення паролю на вашу електронну
              адресу.
            </p>
            <Link
              href="/login"
              className="inline-block mt-4 text-green-600 hover:text-green-700 text-sm font-semibold transition-colors"
            >
              Повернутися до входу
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <p className="text-fg-muted text-sm mb-4">
              Введіть email, і ми надішлемо вам посилання для відновлення паролю.
            </p>

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
                  <p className="mt-1 text-sm text-red-600">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-sm transition-colors text-[13px]"
              >
                {isSubmitting ? 'Завантаження...' : 'Надіслати посилання'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link
                href="/login"
                className="text-sm text-fg-muted hover:text-green-600 transition-colors"
              >
                Повернутися до входу
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
