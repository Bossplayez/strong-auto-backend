'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Loader2, Calendar } from 'lucide-react';
import api from '@/lib/api';
import type { NewsArticle, PaginatedResponse } from '@/lib/types';

export default function NewsPageWrapper() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-green-500" /></div>}>
      <NewsPage />
    </Suspense>
  );
}

function NewsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPage = Number(searchParams.get('page') ?? '1');

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<NewsArticle>['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.news.getAll(currentPage);
      setArticles(response.items);
      setMeta(response.meta);
    } catch {
      setError('Не вдалося завантажити новини.');
    } finally {
      setLoading(false);
    }
  }, [currentPage]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  const handlePageChange = (page: number) => {
    router.push(`/news?page=${page}`);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('uk-UA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-10 max-w-container mx-auto">
      <h1 className="font-display font-bold text-fg" style={{ fontSize: 32 }}>Новини</h1>
      <p className="mt-2 text-fg-muted text-sm">
        Актуальні новини про імпорт авто, зміни в законодавстві та корисні поради
      </p>

      {loading ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-white rounded overflow-hidden">
              <div className="aspect-[16/9] bg-navy-200" />
              <div className="p-4 space-y-3">
                <div className="h-3 w-1/4 rounded bg-navy-100" />
                <div className="h-5 w-3/4 rounded bg-navy-100" />
                <div className="h-4 w-full rounded bg-navy-100" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-red-600">{error}</p>
          <button onClick={fetchNews} className="mt-4 bg-red-500 text-white px-4 py-2 text-sm font-medium rounded-sm">
            Спробувати знову
          </button>
        </div>
      ) : articles.length === 0 ? (
        <div className="mt-8 rounded-lg bg-white border border-border p-12 text-center">
          <p className="text-lg text-fg-muted">Новин поки немає</p>
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((article: any) => {
              const translation =
                article.translations.find((t: any) => t.locale === 'uk') ??
                article.translations[0];
              const coverUrl = article.coverImageUrl || article.coverFile?.storageKey;

              return (
                <Link
                  key={article.id}
                  href={`/news/${article.slug}`}
                  className="group bg-white rounded overflow-hidden transition hover:shadow-md"
                >
                  {coverUrl ? (
                    <div className="relative aspect-[16/9] overflow-hidden">
                      <img
                        src={coverUrl}
                        alt={translation?.title ?? ''}
                        className="w-full h-full object-cover transition group-hover:scale-105"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-[16/9] items-center justify-center" style={{ background: 'var(--navy-800)' }}>
                      <Calendar className="h-10 w-10 text-navy-500" />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-center gap-2 text-xs text-fg-subtle">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(article.createdAt)}
                    </div>
                    <h2 className="mt-2 text-lg font-bold text-fg group-hover:text-green-600 transition font-display">
                      {translation?.title}
                    </h2>
                    {translation?.excerpt && (
                      <p className="mt-2 text-sm text-fg-muted line-clamp-3">
                        {translation.excerpt}
                      </p>
                    )}
                    <span className="mt-3 inline-block text-sm font-semibold text-green-600">
                      Читати далі &rarr;
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              <button
                onClick={() => handlePageChange(meta.page - 1)}
                disabled={meta.page <= 1}
                className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-white text-fg transition hover:border-green-500 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => handlePageChange(page)}
                  className={`flex h-10 w-10 items-center justify-center rounded-sm border text-sm font-medium transition ${
                    page === meta.page
                      ? 'border-green-500 bg-green-500 text-white'
                      : 'border-border bg-white text-fg hover:border-green-500'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => handlePageChange(meta.page + 1)}
                disabled={meta.page >= meta.totalPages}
                className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-white text-fg transition hover:border-green-500 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
