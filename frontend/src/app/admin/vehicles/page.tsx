'use client';

import { useEffect, useState, useCallback } from 'react';
import { admin } from '@/lib/api';
import type { Vehicle, PaginatedResponse } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Pencil, Trash2, Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';

const pubStatusColor: Record<string, string> = {
  PUBLISHED: 'bg-green-500/20 text-green-400',
  DRAFT: 'bg-gray-500/20 text-gray-400',
  READY: 'bg-blue-500/20 text-blue-400',
  HIDDEN: 'bg-yellow-500/20 text-yellow-400',
  ARCHIVED: 'bg-red-500/20 text-red-400',
};

const availColor: Record<string, string> = {
  AVAILABLE: 'bg-green-500/20 text-green-400',
  RESERVED: 'bg-orange-500/20 text-orange-400',
  SOLD: 'bg-red-500/20 text-red-400',
  NOT_AVAILABLE: 'bg-gray-500/20 text-gray-400',
};

export default function VehiclesPage() {
  const [data, setData] = useState<PaginatedResponse<Vehicle> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);

  // Form state
  const [formMake, setFormMake] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formYear, setFormYear] = useState(2024);
  const [formPrice, setFormPrice] = useState(0);
  const [formCurrency, setFormCurrency] = useState('USD');
  const [formSourceType, setFormSourceType] = useState<'INTERNAL' | 'COPART'>('INTERNAL');
  const [formSourceRegion, setFormSourceRegion] = useState<'USA' | 'EUROPE' | 'UKRAINE'>('USA');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await admin.getVehicles(page);
      setData(res);
    } catch (err) {
      console.error('Failed to load vehicles', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await admin.deleteVehicle(id);
      setDeleteId(null);
      load();
    } catch (err) {
      console.error('Failed to delete vehicle', err);
    }
  };

  const handleTogglePublish = async (vehicle: Vehicle) => {
    try {
      if (vehicle.publicationStatus === 'PUBLISHED') {
        await admin.hideVehicle(vehicle.id);
      } else {
        await admin.publishVehicle(vehicle.id);
      }
      load();
    } catch (err) {
      console.error('Failed to toggle publish', err);
    }
  };

  const openCreateForm = () => {
    setEditVehicle(null);
    setFormMake('');
    setFormModel('');
    setFormYear(2024);
    setFormPrice(0);
    setFormCurrency('USD');
    setFormSourceType('INTERNAL');
    setFormSourceRegion('USA');
    setShowForm(true);
  };

  const openEditForm = (v: Vehicle) => {
    setEditVehicle(v);
    setFormMake(v.make);
    setFormModel(v.model);
    setFormYear(v.year);
    setFormPrice(v.priceAmount);
    setFormCurrency(v.currency);
    setFormSourceType(v.sourceType);
    setFormSourceRegion(v.sourceRegion);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        make: formMake,
        model: formModel,
        year: formYear,
        priceAmount: formPrice,
        currency: formCurrency,
        sourceType: formSourceType,
        sourceRegion: formSourceRegion,
      };
      if (editVehicle) {
        await admin.updateVehicle(editVehicle.id, payload);
      } else {
        await admin.createVehicle(payload);
      }
      setShowForm(false);
      load();
    } catch (err) {
      console.error('Failed to save vehicle', err);
    } finally {
      setSaving(false);
    }
  };

  const thumbnail = (v: Vehicle) => {
    const primary = v.media?.find((m) => m.isPrimary) || v.media?.[0];
    return primary?.url;
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Управління авто</h1>
        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Додати авто
        </button>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <div className="rounded-xl border border-[#1e293b] bg-[#111827] p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">
            {editVehicle ? 'Редагувати авто' : 'Нове авто'}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">Марка</label>
              <input
                value={formMake}
                onChange={(e) => setFormMake(e.target.value)}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Модель</label>
              <input
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Рік</label>
              <input
                type="number"
                value={formYear}
                onChange={(e) => setFormYear(Number(e.target.value))}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Ціна</label>
              <input
                type="number"
                value={formPrice}
                onChange={(e) => setFormPrice(Number(e.target.value))}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Валюта</label>
              <select
                value={formCurrency}
                onChange={(e) => setFormCurrency(e.target.value)}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="UAH">UAH</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Джерело</label>
              <select
                value={formSourceType}
                onChange={(e) => setFormSourceType(e.target.value as 'INTERNAL' | 'COPART')}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              >
                <option value="INTERNAL">INTERNAL</option>
                <option value="COPART">COPART</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Регіон</label>
              <select
                value={formSourceRegion}
                onChange={(e) => setFormSourceRegion(e.target.value as 'USA' | 'EUROPE' | 'UKRAINE')}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              >
                <option value="USA">USA</option>
                <option value="EUROPE">EUROPE</option>
                <option value="UKRAINE">UKRAINE</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Збереження...' : 'Зберегти'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-[#1e293b] px-4 py-2 text-sm font-medium text-gray-400 hover:bg-[#1e293b] transition-colors"
            >
              Скасувати
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[#1e293b] bg-[#111827]">
        {!data || data.items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-gray-500">
            Немає авто
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e293b] text-left text-gray-400">
                  <th className="px-5 py-3 font-medium">Фото</th>
                  <th className="px-5 py-3 font-medium">Авто</th>
                  <th className="px-5 py-3 font-medium">Ціна</th>
                  <th className="px-5 py-3 font-medium">Публікація</th>
                  <th className="px-5 py-3 font-medium">Наявність</th>
                  <th className="px-5 py-3 font-medium">Джерело</th>
                  <th className="px-5 py-3 font-medium">Дії</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((v) => (
                  <tr key={v.id} className="border-b border-[#1e293b] last:border-0">
                    <td className="px-5 py-3">
                      {thumbnail(v) ? (
                        <img
                          src={thumbnail(v)}
                          alt={`${v.make} ${v.model}`}
                          className="h-10 w-14 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-14 items-center justify-center rounded bg-[#1e293b] text-gray-500 text-xs">
                          N/A
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-white font-medium">
                      {v.make} {v.model} {v.year}
                    </td>
                    <td className="px-5 py-3 text-gray-300">
                      {v.priceAmount.toLocaleString()} {v.currency}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${pubStatusColor[v.publicationStatus] || ''}`}>
                        {v.publicationStatus}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${availColor[v.availabilityStatus] || ''}`}>
                        {v.availabilityStatus}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">{v.sourceType}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditForm(v)}
                          className="rounded p-1.5 text-gray-400 hover:bg-[#1e293b] hover:text-white transition-colors"
                          title="Редагувати"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleTogglePublish(v)}
                          className="rounded p-1.5 text-gray-400 hover:bg-[#1e293b] hover:text-white transition-colors"
                          title={v.publicationStatus === 'PUBLISHED' ? 'Сховати' : 'Опублікувати'}
                        >
                          {v.publicationStatus === 'PUBLISHED' ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setDeleteId(v.id)}
                          className="rounded p-1.5 text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                          title="Видалити"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
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

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-[#1e293b] bg-[#111827] p-6">
            <h3 className="text-lg font-semibold text-white">Видалити авто?</h3>
            <p className="mt-2 text-sm text-gray-400">
              Ця дія незворотна. Авто буде видалено назавжди.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="rounded-lg border border-[#1e293b] px-4 py-2 text-sm text-gray-400 hover:bg-[#1e293b] transition-colors"
              >
                Скасувати
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                Видалити
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
