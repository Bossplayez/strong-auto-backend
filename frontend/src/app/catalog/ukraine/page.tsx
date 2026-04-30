import type { Metadata } from 'next';
import { CatalogContentWrapper } from '@/components/CatalogContent';

export const metadata: Metadata = {
  title: 'Авто в Україні — в наявності | Strong Auto',
  description:
    'Автомобілі в наявності в Україні. Перевірені авто з гарантією, готові до покупки та оформлення. Доставка по всій Україні.',
};

export default function UkraineCatalogPage() {
  return <CatalogContentWrapper category="UKRAINE" title="Авто в Україні" />;
}
