import type { Metadata } from 'next';
import { CatalogContentWrapper } from '@/components/CatalogContent';

export const metadata: Metadata = {
  title: 'Авто в дорозі — скоро в Україні | Strong Auto',
  description:
    'Автомобілі в дорозі з США та Європи. Забронюйте авто, яке вже їде в Україну, за найкращою ціною.',
};

export default function TransitCatalogPage() {
  return <CatalogContentWrapper category="TRANSIT" title="Авто в дорозі" />;
}
