'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { UserCircle, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { me } from '@/lib/api';
import type { UpdateProfileDto } from '@/lib/types';

const profileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  city: z.string().optional(),
  preferredLanguage: z.enum(['uk', 'en', 'ru']),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      city: '',
      preferredLanguage: 'uk',
    },
  });

  useEffect(() => {
    async function loadProfile() {
      try {
        const profile = await me.getProfile();
        reset({
          firstName: profile.profile?.firstName || '',
          lastName: profile.profile?.lastName || '',
          city: profile.profile?.city || '',
          preferredLanguage:
            (profile.profile?.preferredLanguage as 'uk' | 'en' | 'ru') || 'uk',
        });
      } catch {
        if (user?.profile) {
          reset({
            firstName: user.profile.firstName || '',
            lastName: user.profile.lastName || '',
            city: user.profile.city || '',
            preferredLanguage:
              (user.profile.preferredLanguage as 'uk' | 'en' | 'ru') || 'uk',
          });
        }
      } finally {
        setIsLoading(false);
      }
    }
    loadProfile();
  }, [reset, user]);

  const onSubmit = async (data: ProfileFormData) => {
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      const dto: UpdateProfileDto = {
        firstName: data.firstName || undefined,
        lastName: data.lastName || undefined,
        city: data.city || undefined,
        preferredLanguage: data.preferredLanguage,
      };
      await me.updateProfile(dto);
      setSuccessMessage('Профіль успішно оновлено');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Помилка при оновленні профілю';
      setErrorMessage(message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const inputClass = 'w-full px-4 py-2.5 bg-white border border-border rounded-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/30 transition-colors';

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <UserCircle className="w-8 h-8 text-green-500" />
        <h1 className="text-2xl font-bold text-fg font-display">Профіль</h1>
      </div>

      {successMessage && (
        <div className="p-3 rounded-sm bg-green-50 border border-green-200 flex items-center gap-2 text-green-700 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="p-3 rounded-sm bg-red-50 border border-red-200 flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {errorMessage}
        </div>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-white border border-border rounded-lg p-6 space-y-5"
      >
        {/* Email (read-only) */}
        <div>
          <label className="block text-sm text-fg-muted mb-1.5">Email</label>
          <input
            type="email"
            value={user?.email || ''}
            readOnly
            className="w-full px-4 py-2.5 bg-background border border-border rounded-sm text-fg-subtle cursor-not-allowed"
          />
        </div>

        {/* First name */}
        <div>
          <label className="block text-sm text-fg-muted mb-1.5">Ім&apos;я</label>
          <input
            type="text"
            {...register('firstName')}
            className={inputClass}
            placeholder="Ваше ім'я"
          />
        </div>

        {/* Last name */}
        <div>
          <label className="block text-sm text-fg-muted mb-1.5">Прізвище</label>
          <input
            type="text"
            {...register('lastName')}
            className={inputClass}
            placeholder="Ваше прізвище"
          />
        </div>

        {/* City */}
        <div>
          <label className="block text-sm text-fg-muted mb-1.5">Місто</label>
          <input
            type="text"
            {...register('city')}
            className={inputClass}
            placeholder="Ваше місто"
          />
        </div>

        {/* Preferred language */}
        <div>
          <label className="block text-sm text-fg-muted mb-1.5">Мова</label>
          <select
            {...register('preferredLanguage')}
            className={inputClass}
          >
            <option value="uk">Українська</option>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !isDirty}
          className="flex items-center gap-2 px-6 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-sm transition-colors"
        >
          <Save className="w-4 h-4" />
          {isSubmitting ? 'Збереження...' : 'Зберегти'}
        </button>
      </form>
    </div>
  );
}
