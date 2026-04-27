'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Calendar, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import type { NewsArticle } from '@/lib/types';

export default function NewsArticlePage() {
  const params = useParams<{ slug: string }>();
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchArticle() {
      if (!params.slug) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.news.getBySlug(params.slug);
        setArticle(data);
      } catch (err) {
        setError('Не вдалося завантажити статтю.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchArticle();
  }, [params.slug]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('uk-UA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-500" />
      </main>
    );
  }

  if (error || !article) {
    return (
      <main className="px-8 py-10 max-w-container mx-auto">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/news"
            className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 font-semibold"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад до новин
          </Link>
          <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-red-600">{error ?? 'Статтю не знайдено'}</p>
          </div>
        </div>
      </main>
    );
  }

  const translation =
    article.translations.find((t) => t.locale === 'uk') ?? article.translations[0];

  return (
    <main className="px-8 py-10 max-w-container mx-auto">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/news"
          className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 font-semibold"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад до новин
        </Link>

        {article.coverImageUrl && (
          <div className="relative mt-6 aspect-[16/9] overflow-hidden rounded-lg border border-border">
            <Image
              src={article.coverImageUrl}
              alt={translation?.title ?? ''}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
            />
          </div>
        )}

        <div className="mt-6">
          <div className="flex items-center gap-2 text-sm text-fg-subtle">
            <Calendar className="h-4 w-4" />
            {formatDate(article.createdAt)}
          </div>

          <h1 className="mt-3 font-display font-bold text-fg" style={{ fontSize: 32 }}>
            {translation?.title}
          </h1>

          {translation?.body && (
            <div
              className="prose mt-8 max-w-none text-fg-muted prose-headings:text-fg prose-headings:font-display prose-a:text-green-600 prose-strong:text-fg prose-img:rounded-lg"
              dangerouslySetInnerHTML={{ __html: translation.body }}
            />
          )}
        </div>

        <div className="mt-12 border-t border-border pt-6">
          <Link
            href="/news"
            className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 font-semibold"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад до новин
          </Link>
        </div>
      </div>
    </main>
  );
}
