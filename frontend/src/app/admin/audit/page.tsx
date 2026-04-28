'use client';

import { useEffect, useState, useCallback } from 'react';
import { admin } from '@/lib/api';
import type { PaginatedResponse } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  actorEmail?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt: string;
}

export default function AuditPage() {
  const [data, setData] = useState<PaginatedResponse<AuditLog> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await admin.getAuditLogs(page);
      setData(res as PaginatedResponse<AuditLog>);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
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
      <h1 className="text-2xl font-bold text-white">Журнал аудиту</h1>

      <div className="rounded-xl border border-[#1e293b] bg-[#111827]">
        {!data || data.items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-gray-500">
            Немає записів
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e293b] text-left text-gray-400">
                  <th className="w-8 px-5 py-3" />
                  <th className="px-5 py-3 font-medium">Дата/час</th>
                  <th className="px-5 py-3 font-medium">Користувач</th>
                  <th className="px-5 py-3 font-medium">Дія</th>
                  <th className="px-5 py-3 font-medium">Тип</th>
                  <th className="px-5 py-3 font-medium">ID</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((log) => (
                  <>
                    <tr
                      key={log.id}
                      className="border-b border-[#1e293b] last:border-0 cursor-pointer hover:bg-[#1e293b]/30 transition-colors"
                      onClick={() => toggleExpand(log.id)}
                    >
                      <td className="px-5 py-3">
                        {log.before || log.after ? (
                          expandedId === log.id ? (
                            <ChevronUp className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          )
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-gray-300 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('uk-UA')}
                      </td>
                      <td className="px-5 py-3 text-white">
                        {log.actorEmail || log.actorId || '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className="rounded-full bg-[#3b82f6]/10 px-2.5 py-0.5 text-xs font-medium text-[#3b82f6]">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-400">{log.entityType}</td>
                      <td className="px-5 py-3 text-gray-500 font-mono text-xs">
                        {log.entityId}
                      </td>
                    </tr>

                    {expandedId === log.id && (log.before || log.after) && (
                      <tr key={`${log.id}-diff`} className="border-b border-[#1e293b]">
                        <td colSpan={6} className="bg-[#0a0a0a]/50 px-10 py-4">
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {log.before && (
                              <div>
                                <h4 className="mb-2 text-xs font-semibold uppercase text-red-400">
                                  До
                                </h4>
                                <pre className="max-h-64 overflow-auto rounded-lg border border-[#1e293b] bg-[#111827] p-3 text-xs text-gray-300">
                                  {JSON.stringify(log.before, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.after && (
                              <div>
                                <h4 className="mb-2 text-xs font-semibold uppercase text-green-400">
                                  Після
                                </h4>
                                <pre className="max-h-64 overflow-auto rounded-lg border border-[#1e293b] bg-[#111827] p-3 text-xs text-gray-300">
                                  {JSON.stringify(log.after, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
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
