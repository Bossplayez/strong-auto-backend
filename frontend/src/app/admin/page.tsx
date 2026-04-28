'use client';

import { useEffect, useState } from 'react';
import { admin } from '@/lib/api';
import type { Vehicle, Lead, User, NewsArticle, PaginatedResponse } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { Car, Users, UserCog, Newspaper, Plus, Eye, Send } from 'lucide-react';
import Link from 'next/link';

interface DashboardStats {
  vehiclesCount: number;
  leadsCount: number;
  usersCount: number;
  newsCount: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    vehiclesCount: 0,
    leadsCount: 0,
    usersCount: 0,
    newsCount: 0,
  });
  const [recentLeads, setRecentLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [vehicles, leads, users, news] = await Promise.all([
          admin.getVehicles(1),
          admin.getLeads({ page: 1 }),
          admin.getUsers(1),
          admin.getNews(1),
        ]);
        setStats({
          vehiclesCount: vehicles.meta.total,
          leadsCount: leads.meta.total,
          usersCount: users.meta.total,
          newsCount: news.meta.total,
        });
        setRecentLeads(leads.items.slice(0, 5));
      } catch (err) {
        console.error('Failed to load dashboard stats', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const statCards = [
    { label: 'Авто', value: stats.vehiclesCount, icon: Car, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: 'Нові ліди', value: stats.leadsCount, icon: Users, color: 'text-green-400', bg: 'bg-green-400/10' },
    { label: 'Користувачі', value: stats.usersCount, icon: UserCog, color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: 'Новини', value: stats.newsCount, icon: Newspaper, color: 'text-orange-400', bg: 'bg-orange-400/10' },
  ];

  const leadStatusColor: Record<string, string> = {
    NEW: 'bg-blue-500/20 text-blue-400',
    IN_PROGRESS: 'bg-yellow-500/20 text-yellow-400',
    QUALIFIED: 'bg-purple-500/20 text-purple-400',
    WON: 'bg-green-500/20 text-green-400',
    LOST: 'bg-red-500/20 text-red-400',
    SPAM: 'bg-gray-500/20 text-gray-400',
    ARCHIVED: 'bg-gray-500/20 text-gray-400',
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Дашборд</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div
            key={label}
            className="rounded-xl border border-[#1e293b] bg-[#111827] p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{label}</p>
                <p className="mt-1 text-3xl font-bold text-white">{value}</p>
              </div>
              <div className={`rounded-lg p-3 ${bg}`}>
                <Icon className={`h-6 w-6 ${color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent leads */}
      <div className="rounded-xl border border-[#1e293b] bg-[#111827]">
        <div className="flex items-center justify-between border-b border-[#1e293b] px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Останні ліди</h2>
          <Link
            href="/admin/leads"
            className="text-sm text-[#3b82f6] hover:text-blue-400 transition-colors"
          >
            Переглянути всі
          </Link>
        </div>

        {recentLeads.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-gray-500">
            Немає лідів
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e293b] text-left text-gray-400">
                  <th className="px-5 py-3 font-medium">Ім&apos;я</th>
                  <th className="px-5 py-3 font-medium">Телефон</th>
                  <th className="px-5 py-3 font-medium">Тип</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th className="px-5 py-3 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((lead) => (
                  <tr key={lead.id} className="border-b border-[#1e293b] last:border-0">
                    <td className="px-5 py-3 text-white">{lead.name}</td>
                    <td className="px-5 py-3 text-gray-300">{lead.phone}</td>
                    <td className="px-5 py-3 text-gray-300">{lead.leadType}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${leadStatusColor[lead.status] || ''}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(lead.createdAt).toLocaleDateString('uk-UA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border border-[#1e293b] bg-[#111827] p-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Швидкі дії</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/vehicles"
            className="flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Додати авто
          </Link>
          <Link
            href="/admin/leads"
            className="flex items-center gap-2 rounded-lg border border-[#1e293b] bg-[#1e293b]/50 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-[#1e293b] transition-colors"
          >
            <Eye className="h-4 w-4" />
            Переглянути ліди
          </Link>
          <Link
            href="/admin/broadcasts"
            className="flex items-center gap-2 rounded-lg border border-[#1e293b] bg-[#1e293b]/50 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-[#1e293b] transition-colors"
          >
            <Send className="h-4 w-4" />
            Нова розсилка
          </Link>
          <Link
            href="/admin/news"
            className="flex items-center gap-2 rounded-lg border border-[#1e293b] bg-[#1e293b]/50 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-[#1e293b] transition-colors"
          >
            <Newspaper className="h-4 w-4" />
            Створити новину
          </Link>
        </div>
      </div>
    </div>
  );
}
