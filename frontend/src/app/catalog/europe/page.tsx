import type { Metadata } from 'next';
import { CatalogContentWrapper } from '@/components/CatalogContent';

export const metadata: Metadata = {
  title: 'Авто з Європи — купити з доставкою | Strong Auto',
  description:
    'Автомобілі з Європи: Німеччина, Польща, Литва та інші країни. Купити авто з Європи з доставкою в Україну під ключ.',
};

export default function EuropeCatalogPage() {
  return <CatalogContentWrapper category="EUROPE" title="Авто з Європи" />;
}
