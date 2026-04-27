'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Heart,
  Calculator,
  UserCircle,
  LogOut,
  Menu,
  X,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { label: 'Огляд', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Обране', href: '/dashboard/favorites', icon: Heart },
  { label: 'Розрахунки', href: '/dashboard/calculations', icon: Calculator },
  { label: 'Профіль', href: '/dashboard/profile', icon: UserCircle },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const displayName =
    user?.profile?.firstName || user?.email || 'Користувач';

  return (
    <div className="flex min-h-[60vh]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-border flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* User info */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-fg font-bold truncate">{displayName}</p>
              <p className="text-fg-subtle text-sm truncate">{user?.email}</p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-fg-muted hover:text-fg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors ${
                  active
                    ? 'bg-green-500/10 text-green-600'
                    : 'text-fg-muted hover:text-fg hover:bg-background'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}

          {user?.userType === 'ADMIN' && (
            <Link
              href="/admin"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium text-amber-600 hover:bg-background transition-colors"
            >
              <ShieldCheck className="w-5 h-5" />
              Адмін панель
            </Link>
          )}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium text-fg-muted hover:text-red-600 hover:bg-red-50 transition-colors w-full"
          >
            <LogOut className="w-5 h-5" />
            Вийти
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-border">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-fg-muted hover:text-fg"
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="text-fg font-display font-bold">Strong Auto</span>
          <div className="w-6" />
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
