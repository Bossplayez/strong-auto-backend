'use client';

import { DollarSign, Truck, Shield, Gavel } from 'lucide-react';
import { CalculatorForm } from '@/components/CalculatorForm';

export default function CalculatorPage() {
  return (
    <main className="px-4 sm:px-8 py-6 sm:py-10 max-w-container mx-auto">
      <h1 className="font-display font-bold text-fg text-2xl sm:text-[32px]">Калькулятор вартості</h1>
      <p className="mt-2 max-w-2xl text-fg-muted text-sm">
        Розрахуйте повну вартість імпорту автомобіля з США в Україну. Калькулятор
        враховує ціну авто, аукціонний збір, доставку, розмитнення та страхування.
      </p>

      {/* Calculator Form */}
      <div className="mt-8 rounded-lg border border-border bg-white p-6 sm:p-8">
        <CalculatorForm />
      </div>

      {/* Info Cards */}
      <div className="mt-12">
        <h2 className="font-display font-bold text-fg" style={{ fontSize: 22 }}>Що входить у розрахунок</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <InfoCard
            icon={<Gavel className="h-6 w-6 text-orange-500" />}
            title="Аукціонний збір"
            description="Комісія аукціону (COPART, IAAI) за проведення торгів. Залежить від фінальної ціни автомобіля та типу ліцензії покупця."
          />
          <InfoCard
            icon={<Truck className="h-6 w-6 text-green-500" />}
            title="Логістика"
            description="Доставка автомобіля з аукціону до порту, морський фрахт до Одеси або Клайпеди, та внутрішня доставка до вашого міста в Україні."
          />
          <InfoCard
            icon={<DollarSign className="h-6 w-6 text-green-600" />}
            title="Розмитнення"
            description="Ввізне мито, акцизний збір та ПДВ. Розраховується на основі типу палива, об'єму двигуна та року випуску автомобіля."
          />
          <InfoCard
            icon={<Shield className="h-6 w-6 text-navy-600" />}
            title="Страхування"
            description="Морське страхування вантажу на весь час транспортування. Покриває ризики пошкодження або втрати під час перевезення."
          />
        </div>
      </div>
    </main>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-5">
      <div className="mb-3">{icon}</div>
      <h3 className="text-base font-bold text-fg">{title}</h3>
      <p className="mt-2 text-sm text-fg-muted">{description}</p>
    </div>
  );
}
