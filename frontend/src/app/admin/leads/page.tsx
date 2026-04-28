'use client';

import { useEffect, useState, useCallback } from 'react';
import { admin } from '@/lib/api';
import type { Lead, LeadStatus, PaginatedResponse } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { Search, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';

const leadStatuses: LeadStatus[] = ['NEW', 'IN_PROGRESS', 'QUALIFIED', 'WON', 'LOST', 'SPAM', 'ARCHIVED'];

const statusColor: Record<string, string> = {
  NEW: 'bg-blue-500/20 text-blue-400',
  IN_PROGRESS: 'bg-yellow-500/20 text-yellow-400',
  QUALIFIED: 'bg-purple-500/20 text-purple-400',
  WON: 'bg-green-500/20 text-green-400',
  LOST: 'bg-red-500/20 text-red-400',
  SPAM: 'bg-gray-500/20 text-gray-400',
  ARCHIVED: 'bg-gray-500/20 text-gray-400',
};

const leadTypeLabel: Record<string, string> = {
  CONTACT_FORM: 'Контакт',
  CALLBACK: 'Зворотний дзвінок',
  CATALOG_REQUEST: 'Каталог',
  CALCULATOR_REQUEST: 'Калькулятор',
  SELECTION_REQUEST: 'Підбір',
};

export default function LeadsPage() {
  const [data, setData] = useState<PaginatedResponse<Lead> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<LeadStatus | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedLead, setExpandedLead] = useState<Lead | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: { page?: number; status?: LeadStatus } = { page };
      if (filterStatus) query.status = filterStatus;
      const res = await admin.getLeads(query);
      setData(res);
    } catch (err) {
      console.error('Failed to load leads', err);
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedLead(null);
      return;
    }
    try {
      const lead = await admin.getLead(id);
      setExpandedId(id);
      setExpandedLead(lead);
    } catch (err) {
      console.error('Failed to load lead details', err);
    }
  };

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    try {
      await admin.updateLead(leadId, { status: newStatus });
      load();
    } catch (err) {
      console.error('Failed to update lead status', err);
    }
  };

  const handleAssignManager = async (leadId: string, userId: string) => {
    try {
      await admin.updateLead(leadId, { assignedToUserId: userId || undefined });
      load();
    } catch (err) {
      console.error('Failed to assign manager', err);
    }
  };

  const filteredItems = data?.items.filter((lead) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      lead.name.toLowerCase().includes(q) ||
      lead.phone.toLowerCase().includes(q) ||
      (lead.email && lead.email.toLowerCase().includes(q))
    );
  });

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Ліди</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value as LeadStatus | '');
            setPage(1);
          }}
          className="rounded-lg border border-[#1e293b] bg-[#111827] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
        >
          <option value="">Всі статуси</option>
          {leadStatuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Пошук за ім'ям, телефоном, email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[#1e293b] bg-[#111827] py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:border-[#3b82f6] focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#1e293b] bg-[#111827]">
        {!filteredItems || filteredItems.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-gray-500">
            Немає лідів
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e293b] text-left text-gray-400">
                  <th className="w-8 px-5 py-3" />
                  <th className="px-5 py-3 font-medium">Ім&apos;я</th>
                  <th className="px-5 py-3 font-medium">Телефон</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Тип</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th className="px-5 py-3 font-medium">Менеджер</th>
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium">Дії</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((lead) => (
                  <>
                    <tr
                      key={lead.id}
                      className="border-b border-[#1e293b] last:border-0 cursor-pointer hover:bg-[#1e293b]/30 transition-colors"
                      onClick={() => handleExpand(lead.id)}
                    >
                      <td className="px-5 py-3">
                        {expandedId === lead.id ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </td>
                      <td className="px-5 py-3 text-white font-medium">{lead.name}</td>
                      <td className="px-5 py-3 text-gray-300">{lead.phone}</td>
                      <td className="px-5 py-3 text-gray-300">{lead.email || '—'}</td>
                      <td className="px-5 py-3 text-gray-300">
                        {leadTypeLabel[lead.leadType] || lead.leadType}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[lead.status] || ''}`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-400">
                        {lead.assignedTo?.email || '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-400">
                        {new Date(lead.createdAt).toLocaleDateString('uk-UA')}
                      </td>
                      <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.status}
                          onChange={(e) => handleStatusChange(lead.id, e.target.value as LeadStatus)}
                          className="rounded border border-[#1e293b] bg-[#0a0a0a] px-2 py-1 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
                        >
                          {leadStatuses.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>

                    {expandedId === lead.id && expandedLead && (
                      <tr key={`${lead.id}-details`} className="border-b border-[#1e293b]">
                        <td colSpan={9} className="bg-[#0a0a0a]/50 px-10 py-4">
                          <div className="space-y-4">
                            {/* Comments */}
                            <div>
                              <h4 className="mb-2 text-sm font-semibold text-gray-300">Коментарі</h4>
                              {expandedLead.comments && expandedLead.comments.length > 0 ? (
                                <ul className="space-y-2">
                                  {expandedLead.comments.map((c) => (
                                    <li key={c.id} className="rounded-lg border border-[#1e293b] bg-[#111827] p-3 text-sm">
                                      <div className="flex items-center gap-2 text-gray-400">
                                        <span>{c.author?.email || c.authorId}</span>
                                        <span>&middot;</span>
                                        <span>{new Date(c.createdAt).toLocaleString('uk-UA')}</span>
                                      </div>
                                      <p className="mt-1 text-gray-200">{c.text}</p>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-sm text-gray-500">Немає коментарів</p>
                              )}
                            </div>

                            {/* Status history */}
                            <div>
                              <h4 className="mb-2 text-sm font-semibold text-gray-300">Історія статусів</h4>
                              {expandedLead.statusHistory && expandedLead.statusHistory.length > 0 ? (
                                <ul className="space-y-1">
                                  {expandedLead.statusHistory.map((h) => (
                                    <li key={h.id} className="flex items-center gap-2 text-sm text-gray-400">
                                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[h.fromStatus] || ''}`}>
                                        {h.fromStatus}
                                      </span>
                                      <span className="text-gray-600">&rarr;</span>
                                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[h.toStatus] || ''}`}>
                                        {h.toStatus}
                                      </span>
                                      <span className="text-gray-600">&middot;</span>
                                      <span>{new Date(h.createdAt).toLocaleString('uk-UA')}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-sm text-gray-500">Немає історії</p>
                              )}
                            </div>

                            {/* Comment */}
                            {expandedLead.comment && (
                              <div>
                                <h4 className="mb-1 text-sm font-semibold text-gray-300">Коментар клієнта</h4>
                                <p className="text-sm text-gray-300">{expandedLead.comment}</p>
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

        {/* Pagination */}
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
