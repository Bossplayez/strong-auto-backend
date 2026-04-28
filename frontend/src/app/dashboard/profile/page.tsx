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
        // Use existing user data as fallback
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
        <div className="w-8 h-8 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <UserCircle className="w-8 h-8 text-[#3b82f6]" />
        <h1 className="text-2xl font-bold text-white">Профіль</h1>
      </div>

      {successMessage && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-2 text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {errorMessage}
        </div>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 space-y-5"
      >
        {/* Email (read-only) */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Email</label>
          <input
            type="email"
            value={user?.email || ''}
            readOnly
            className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-[#1e293b] rounded-lg text-gray-500 cursor-not-allowed"
          />
        </div>

        {/* First name */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Ім&apos;я</label>
          <input
            type="text"
            {...register('firstName')}
            className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-[#1e293b] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#3b82f6] transition-colors"
            placeholder="Ваше ім'я"
          />
        </div>

        {/* Last name */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Прізвище</label>
          <input
            type="text"
            {...register('lastName')}
            className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-[#1e293b] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#3b82f6] transition-colors"
            placeholder="Ваше прізвище"
          />
        </div>

        {/* City */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Місто</label>
          <input
            type="text"
            {...register('city')}
            className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-[#1e293b] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#3b82f6] transition-colors"
            placeholder="Ваше місто"
          />
        </div>

        {/* Preferred language */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Мова</label>
          <select
            {...register('preferredLanguage')}
            className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-[#1e293b] rounded-lg text-white focus:outline-none focus:border-[#3b82f6] transition-colors"
          >
            <option value="uk">Українська</option>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !isDirty}
          className="flex items-center gap-2 px-6 py-2.5 bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          <Save className="w-4 h-4" />
          {isSubmitting ? 'Збереження...' : 'Зберегти'}
        </button>
      </form>
    </div>
  );
}
