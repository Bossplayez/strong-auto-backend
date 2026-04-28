'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import {
  LayoutDashboard,
  Car,
  Users,
  UserCog,
  Newspaper,
  Send,
  Shield,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { href: '/admin', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/admin/vehicles', label: 'Авто', icon: Car },
  { href: '/admin/leads', label: 'Ліди', icon: Users },
  { href: '/admin/users', label: 'Користувачі', icon: UserCog },
  { href: '/admin/news', label: 'Новини', icon: Newspaper },
  { href: '/admin/broadcasts', label: 'Розсилки', icon: Send },
  { href: '/admin/audit', label: 'Аудит', icon: Shield },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && (!user || user.userType !== 'ADMIN')) {
      router.replace('/');
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
      </div>
    );
  }

  if (!user || user.userType !== 'ADMIN') {
    return null;
  }

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  };

  return (
    <div className="flex h-screen flex-col bg-[#0a0a0a] text-gray-100">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1e293b] bg-[#111827] px-6">
        <Link href="/admin" className="text-lg font-bold text-white">
          Strong Auto <span className="text-[#3b82f6]">Admin</span>
        </Link>

        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-[#1e293b] transition-colors"
          >
            <span>{user.email}</span>
            <ChevronDown className="h-4 w-4" />
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-[#1e293b] bg-[#111827] py-1 shadow-xl">
                <button
                  onClick={() => {
                    logout();
                    router.replace('/');
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-[#1e293b] transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Вийти
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-[#1e293b] bg-[#111827]">
          <nav className="flex flex-1 flex-col gap-1 p-3">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-[#3b82f6]/10 text-[#3b82f6]'
                    : 'text-gray-400 hover:bg-[#1e293b] hover:text-gray-200'
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
