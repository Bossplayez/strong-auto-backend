'use client';

import { useEffect, useState, useCallback } from 'react';
import { admin } from '@/lib/api';
import type { NewsArticle, NewsStatus, PaginatedResponse } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

const newsStatusColor: Record<string, string> = {
  DRAFT: 'bg-gray-500/20 text-gray-400',
  PUBLISHED: 'bg-green-500/20 text-green-400',
  ARCHIVED: 'bg-red-500/20 text-red-400',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

export default function NewsPage() {
  const [data, setData] = useState<PaginatedResponse<NewsArticle> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editArticle, setEditArticle] = useState<NewsArticle | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formExcerpt, setFormExcerpt] = useState('');
  const [formStatus, setFormStatus] = useState<NewsStatus>('DRAFT');
  const [formLocale, setFormLocale] = useState('uk');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await admin.getNews(page);
      setData(res);
    } catch (err) {
      console.error('Failed to load news', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreateForm = () => {
    setEditArticle(null);
    setFormTitle('');
    setFormSlug('');
    setFormBody('');
    setFormExcerpt('');
    setFormStatus('DRAFT');
    setFormLocale('uk');
    setShowForm(true);
  };

  const openEditForm = (article: NewsArticle) => {
    const t = article.translations?.[0];
    setEditArticle(article);
    setFormTitle(t?.title || '');
    setFormSlug(article.slug);
    setFormBody(t?.body || '');
    setFormExcerpt(t?.excerpt || '');
    setFormStatus(article.status);
    setFormLocale(t?.locale || 'uk');
    setShowForm(true);
  };

  const handleTitleChange = (value: string) => {
    setFormTitle(value);
    if (!editArticle) {
      setFormSlug(slugify(value));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Partial<NewsArticle> = {
        slug: formSlug,
        status: formStatus,
        translations: [
          {
            locale: formLocale,
            title: formTitle,
            body: formBody,
            excerpt: formExcerpt || undefined,
          },
        ],
      };
      if (editArticle) {
        await admin.updateNews(editArticle.id, payload);
      } else {
        await admin.createNews(payload);
      }
      setShowForm(false);
      load();
    } catch (err) {
      console.error('Failed to save news', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await admin.deleteNews(id);
      setDeleteId(null);
      load();
    } catch (err) {
      console.error('Failed to delete news', err);
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Новини</h1>
        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Створити
        </button>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <div className="rounded-xl border border-[#1e293b] bg-[#111827] p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">
            {editArticle ? 'Редагувати новину' : 'Нова новина'}
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-gray-400">Заголовок</label>
                <input
                  value={formTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Slug</label>
                <input
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-gray-400 focus:border-[#3b82f6] focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Короткий опис</label>
              <input
                value={formExcerpt}
                onChange={(e) => setFormExcerpt(e.target.value)}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Текст</label>
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none resize-y"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-gray-400">Статус</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as NewsStatus)}
                  className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
                >
                  <option value="DRAFT">DRAFT</option>
                  <option value="PUBLISHED">PUBLISHED</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Мова</label>
                <select
                  value={formLocale}
                  onChange={(e) => setFormLocale(e.target.value)}
                  className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
                >
                  <option value="uk">Українська</option>
                  <option value="en">English</option>
                </select>
              </div>
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
            Немає новин
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e293b] text-left text-gray-400">
                  <th className="px-5 py-3 font-medium">Заголовок</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium">Дії</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((article) => (
                  <tr key={article.id} className="border-b border-[#1e293b] last:border-0">
                    <td className="px-5 py-3 text-white font-medium">
                      {article.translations?.[0]?.title || article.slug}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${newsStatusColor[article.status] || ''}`}>
                        {article.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">
                      {new Date(article.createdAt).toLocaleDateString('uk-UA')}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditForm(article)}
                          className="rounded p-1.5 text-gray-400 hover:bg-[#1e293b] hover:text-white transition-colors"
                          title="Редагувати"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(article.id)}
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
            <h3 className="text-lg font-semibold text-white">Видалити новину?</h3>
            <p className="mt-2 text-sm text-gray-400">
              Ця дія незворотна. Новину буде видалено назавжди.
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
