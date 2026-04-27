'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Gavel,
  Truck,
  Flag,
  Newspaper,
  Info,
  Phone,
} from 'lucide-react';

const sidebarLinks = [
  { href: '/', id: 'home', label: 'Головна', icon: Home },
  { href: '/catalog?sourceRegion=USA', id: 'auction', label: 'Аукціон', icon: Gavel },
  { href: '/catalog?sourceRegion=transit', id: 'transit', label: 'Авто в\u00a0дорозі', icon: Truck },
  { href: '/catalog?sourceRegion=USA', id: 'usa', label: 'Авто з\u00a0США', icon: Flag },
  { href: '/news', id: 'news', label: 'Новини', icon: Newspaper },
  { href: '/about', id: 'about', label: 'Про компанію', icon: Info },
  { href: '/contacts', id: 'contact', label: 'Контакти', icon: Phone },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="hidden lg:flex flex-col items-center shrink-0 bg-white border-r border-border"
      style={{ width: 76, paddingTop: 16, gap: 4, position: 'sticky', top: 70, height: 'calc(100vh - 70px)', overflowY: 'auto' }}
    >
      {sidebarLinks.map((link) => {
        const Icon = link.icon;
        const isActive = pathname === link.href.split('?')[0] ||
          (link.href !== '/' && pathname.startsWith(link.href.split('?')[0]));

        return (
          <Link
            key={link.id}
            href={link.href}
            className={`flex flex-col items-center gap-1 px-1.5 py-2.5 rounded-sm transition-colors text-center ${
              isActive
                ? 'bg-background text-fg'
                : 'text-fg-muted hover:bg-background hover:text-fg'
            }`}
            style={{ width: 64 }}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[9px] font-semibold leading-tight">{link.label}</span>
          </Link>
        );
      })}
    </aside>
  );
}
