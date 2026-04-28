'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { me } from '@/lib/api';
import type { CalculatorEstimate, PaginatedResponse } from '@/lib/types';

export default function CalculationsPage() {
  const [calculations, setCalculations] = useState<CalculatorEstimate[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<CalculatorEstimate>['meta'] | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchCalculations = useCallback(async (p: number) => {
    setIsLoading(true);
    try {
      const res = await me.getCalculations(p);
      setCalculations(res.items);
      setMeta(res.meta);
    } catch {
      // Handle error silently
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalculations(page);
  }, [page, fetchCalculations]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number, currency: string) => {
    return `${amount.toLocaleString()} ${currency}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-fg font-display">Збережені розрахунки</h1>

      {calculations.length === 0 ? (
        <div className="bg-white border border-border rounded-lg p-12 text-center">
          <Calculator className="w-12 h-12 text-fg-subtle mx-auto mb-4" />
          <p className="text-fg-muted mb-4">У вас немає збережених розрахунків</p>
          <Link
            href="/calculator"
            className="inline-block px-6 py-2.5 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-sm transition-colors"
          >
            Розрахувати вартість
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {calculations.map((calc) => (
              <div
                key={calc.id}
                className="bg-white border border-border rounded-lg overflow-hidden"
              >
                {/* Row header */}
                <button
                  onClick={() => toggleExpand(calc.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-background transition-colors text-left"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <span className="text-fg-muted text-sm whitespace-nowrap">
                      {formatDate(calc.createdAt)}
                    </span>
                    <span className="text-fg text-sm truncate">
                      {calc.input.fuelType} {calc.input.engineVolume}L,{' '}
                      {calc.input.year} р.
                    </span>
                    <span className="text-green-600 font-semibold text-sm whitespace-nowrap ml-auto mr-2">
                      {formatCurrency(calc.totalAmount, calc.totalCurrency)}
                    </span>
                  </div>
                  {expandedId === calc.id ? (
                    <ChevronUp className="w-5 h-5 text-fg-muted shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-fg-muted shrink-0" />
                  )}
                </button>

                {/* Expanded breakdown */}
                {expandedId === calc.id && (
                  <div className="px-4 pb-4 border-t border-border">
                    <div className="pt-4 space-y-3">
                      {/* Input summary */}
                      <div>
                        <p className="text-fg-subtle text-xs uppercase tracking-wider mb-2">
                          Вхідні дані
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                          <div>
                            <span className="text-fg-muted">Ціна: </span>
                            <span className="text-fg">
                              {formatCurrency(calc.input.priceAmount, calc.input.currency)}
                            </span>
                          </div>
                          <div>
                            <span className="text-fg-muted">Паливо: </span>
                            <span className="text-fg">{calc.input.fuelType}</span>
                          </div>
                          <div>
                            <span className="text-fg-muted">Об&apos;єм: </span>
                            <span className="text-fg">{calc.input.engineVolume}L</span>
                          </div>
                          <div>
                            <span className="text-fg-muted">Рік: </span>
                            <span className="text-fg">{calc.input.year}</span>
                          </div>
                          {calc.input.sourceCountry && (
                            <div>
                              <span className="text-fg-muted">Країна: </span>
                              <span className="text-fg">{calc.input.sourceCountry}</span>
                            </div>
                          )}
                          {calc.input.destinationCity && (
                            <div>
                              <span className="text-fg-muted">Місто: </span>
                              <span className="text-fg">{calc.input.destinationCity}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Breakdown */}
                      <div>
                        <p className="text-fg-subtle text-xs uppercase tracking-wider mb-2">
                          Деталізація
                        </p>
                        <div className="space-y-1.5">
                          {calc.output.lines.map((line, i) => (
                            <div
                              key={i}
                              className="flex justify-between text-sm"
                            >
                              <span className="text-fg-muted">{line.label}</span>
                              <span className="text-fg">
                                {formatCurrency(line.amount, line.currency)}
                              </span>
                            </div>
                          ))}
                          <div className="flex justify-between text-sm pt-2 border-t border-border font-semibold">
                            <span className="text-fg">Разом</span>
                            <span className="text-green-600">
                              {formatCurrency(calc.output.totalAmount, calc.output.totalCurrency)}
                            </span>
                          </div>
                          {calc.output.exchangeRate > 0 && (
                            <p className="text-fg-subtle text-xs mt-1">
                              Курс: {calc.output.exchangeRate}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-white border border-border text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-fg-muted text-sm px-4">
                {page} / {meta.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                disabled={page >= meta.totalPages}
                className="p-2 rounded-lg bg-white border border-border text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
