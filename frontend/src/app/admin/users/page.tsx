'use client';

import { useEffect, useState, useCallback } from 'react';
import { admin } from '@/lib/api';
import type { User, UserType, UserStatus, PaginatedResponse } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { ChevronLeft, ChevronRight, ShieldCheck, ShieldOff } from 'lucide-react';

const userTypeColor: Record<string, string> = {
  ADMIN: 'bg-purple-500/20 text-purple-400',
  STAFF: 'bg-blue-500/20 text-blue-400',
  CUSTOMER: 'bg-gray-500/20 text-gray-400',
};

const userStatusColor: Record<string, string> = {
  ACTIVE: 'bg-green-500/20 text-green-400',
  PENDING_VERIFICATION: 'bg-yellow-500/20 text-yellow-400',
  BLOCKED: 'bg-red-500/20 text-red-400',
  DELETED: 'bg-gray-500/20 text-gray-400',
};

export default function UsersPage() {
  const [data, setData] = useState<PaginatedResponse<User> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await admin.getUsers(page);
      setData(res);
    } catch (err) {
      console.error('Failed to load users', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleBlock = async (user: User) => {
    try {
      const newStatus: UserStatus = user.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
      await admin.updateUser(user.id, { status: newStatus });
      load();
    } catch (err) {
      console.error('Failed to update user status', err);
    }
  };

  const handleChangeRole = async (userId: string, newRole: UserType) => {
    try {
      await admin.updateUser(userId, { userType: newRole });
      load();
    } catch (err) {
      console.error('Failed to change user role', err);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Користувачі</h1>

      <div className="rounded-xl border border-[#1e293b] bg-[#111827]">
        {!data || data.items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-gray-500">
            Немає користувачів
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e293b] text-left text-gray-400">
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Телефон</th>
                  <th className="px-5 py-3 font-medium">Роль</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th className="px-5 py-3 font-medium">Реєстрація</th>
                  <th className="px-5 py-3 font-medium">Дії</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className="border-b border-[#1e293b] last:border-0">
                    <td className="px-5 py-3 text-white">{u.email}</td>
                    <td className="px-5 py-3 text-gray-300">{u.phone || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${userTypeColor[u.userType] || ''}`}>
                        {u.userType}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${userStatusColor[u.status] || ''}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(u.createdAt).toLocaleDateString('uk-UA')}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleToggleBlock(u)}
                          className={`rounded p-1.5 transition-colors ${
                            u.status === 'BLOCKED'
                              ? 'text-green-400 hover:bg-green-500/10'
                              : 'text-red-400 hover:bg-red-500/10'
                          }`}
                          title={u.status === 'BLOCKED' ? 'Розблокувати' : 'Заблокувати'}
                        >
                          {u.status === 'BLOCKED' ? (
                            <ShieldCheck className="h-4 w-4" />
                          ) : (
                            <ShieldOff className="h-4 w-4" />
                          )}
                        </button>

                        <select
                          value={u.userType}
                          onChange={(e) => handleChangeRole(u.id, e.target.value as UserType)}
                          className="rounded border border-[#1e293b] bg-[#0a0a0a] px-2 py-1 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
                        >
                          <option value="CUSTOMER">CUSTOMER</option>
                          <option value="STAFF">STAFF</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#1e293b] px-5 py-3">
            <span className="text-sm text-gray-400">
              Сторінка {data.meta.page} з {data.meta.totalPages} (всього {data.meta.total})
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-[#1e293b] p-2 text-gray-400 hover:bg-[#1e293b] disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(data.meta.totalPages, p + 1))}
                disabled={page >= data.meta.totalPages}
                className="rounded-lg border border-[#1e293b] p-2 text-gray-400 hover:bg-[#1e293b] disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
