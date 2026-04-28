'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import type { NewsArticle } from '@/lib/types';

export default function NewsArticlePage() {
  const params = useParams<{ slug: string }>();
  const [article, setArticle] = useState<any | null>(null);
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

  // SEO
  useEffect(() => {
    if (!article) return;
    const translation = article.translations?.find((t: any) => t.locale === 'uk') ?? article.translations?.[0];
    if (translation) {
      document.title = `${translation.title} | Strong Auto`;
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.setAttribute('name', 'description'); document.head.appendChild(metaDesc); }
      metaDesc.setAttribute('content', translation.excerpt || translation.title);
    }
  }, [article]);

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
      <main className="px-4 sm:px-8 py-6 sm:py-10 max-w-container mx-auto">
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
    article.translations?.find((t: any) => t.locale === 'uk') ?? article.translations?.[0];
  const coverUrl = article.coverImageUrl || article.coverFile?.storageKey;

  // Convert markdown-like text to simple HTML
  const formatBody = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n- /g, '</p><li>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <main className="px-4 sm:px-8 py-6 sm:py-10 max-w-container mx-auto">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/news"
          className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 font-semibold"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад до новин
        </Link>

        {coverUrl && (
          <div className="relative mt-6 aspect-[16/9] overflow-hidden rounded-lg border border-border">
            <img
              src={coverUrl}
              alt={translation?.title ?? ''}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="mt-6">
          <div className="flex items-center gap-2 text-sm text-fg-subtle">
            <Calendar className="h-4 w-4" />
            {formatDate(article.publishedAt || article.createdAt)}
          </div>

          <h1 className="mt-3 font-display font-bold text-fg text-2xl sm:text-[32px] leading-tight">
            {translation?.title}
          </h1>

          {translation?.body && (
            <div
              className="mt-8 text-fg-muted leading-relaxed space-y-4 [&_strong]:text-fg [&_strong]:font-semibold [&_li]:ml-4 [&_li]:list-disc"
              dangerouslySetInnerHTML={{ __html: `<p>${formatBody(translation.body)}</p>` }}
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
