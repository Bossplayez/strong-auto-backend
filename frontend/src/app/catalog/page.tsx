import type { Metadata } from 'next';
import { CatalogContentWrapper } from '@/components/CatalogContent';

export const metadata: Metadata = {
  title: 'Каталог авто з США та Європи | Strong Auto',
  description:
    'Купити авто з США, Європи та України. Широкий вибір автомобілів з аукціонів Copart та IAAI, авто в дорозі та в наявності в Україні.',
};

export default function CatalogPage() {
  return <CatalogContentWrapper category="" title="Авто з США та Європи" />;
}
