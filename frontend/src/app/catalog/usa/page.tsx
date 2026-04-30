import type { Metadata } from 'next';
import { CatalogContentWrapper } from '@/components/CatalogContent';

export const metadata: Metadata = {
  title: 'Авто з США — аукціони Copart та IAAI | Strong Auto',
  description:
    'Автомобілі з аукціонів США: Copart, IAAI. Купити авто зі штатів під ключ з доставкою в Україну. Найкращі ціни та широкий вибір.',
};

export default function UsaCatalogPage() {
  return <CatalogContentWrapper category="USA" title="Аукціон (США)" />;
}
