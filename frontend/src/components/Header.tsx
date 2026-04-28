'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X, User, Heart, LogOut, Settings, ChevronDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function Header() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-border" style={{ height: 70 }}>
      <div className="flex items-center h-full px-3 sm:px-6 lg:px-8 xl:pl-[100px] xl:pr-8">
        {/* Mobile hamburger */}
        <button
          className="lg:hidden p-2 mr-3 text-fg-muted hover:text-fg"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>

        {/* Logo */}
        <Link href="/" className="shrink-0">
          <Image src="/assets/strong-logo.svg" alt="STRONG AUTO" width={140} height={36} className="sm:w-[180px] sm:h-[46px]" priority />
        </Link>

        {/* Eyebrow text */}
        <span className="hidden md:inline eyebrow ml-6">
          В наявності та в дорозі
        </span>

        <div className="flex-1" />

        {/* Phone */}
        <a
          href="tel:+380977727878"
          className="hidden md:inline text-sm font-semibold text-fg hover:text-green-600 transition-colors mr-6"
        >
          +380 (97) 772 78 78
        </a>

        {/* Language */}
        <div className="relative hidden sm:block mr-4" ref={langRef}>
          <button
            onClick={() => setLangOpen((v) => !v)}
            className="flex items-center gap-1 text-sm font-semibold text-fg hover:text-fg-muted transition-colors"
          >
            Укр
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {langOpen && (
            <div className="absolute right-0 mt-2 w-32 bg-bg-card border border-border rounded shadow-md py-1 animate-fade-in z-50">
              <button className="w-full px-4 py-2 text-sm text-left text-fg hover:bg-background font-medium">
                Українська
              </button>
              <button className="w-full px-4 py-2 text-sm text-left text-fg-muted hover:bg-background">
                English
              </button>
            </div>
          )}
        </div>

        {/* Favorites */}
        <Link
          href="/dashboard/favorites"
          className="p-1.5 sm:p-2 text-fg hover:text-green-600 transition-colors mr-1 sm:mr-3"
          aria-label="Обране"
        >
          <Heart className="h-5 w-5" />
        </Link>

        {/* Auth */}
        {isAuthenticated ? (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg transition-colors"
            >
              <User className="h-5 w-5" />
              <span className="hidden sm:inline">{user?.profile?.firstName || user?.email}</span>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-bg-card border border-border rounded-lg shadow-lg py-1 animate-fade-in z-50">
                <Link
                  href="/dashboard/profile"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-fg-muted hover:bg-background hover:text-fg transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <User className="h-4 w-4" />
                  Профіль
                </Link>
                <Link
                  href="/dashboard/favorites"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-fg-muted hover:bg-background hover:text-fg transition-colors"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Heart className="h-4 w-4" />
                  Обране
                </Link>
                {isAdmin && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-fg-muted hover:bg-background hover:text-fg transition-colors"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <Settings className="h-4 w-4" />
                    Адмін
                  </Link>
                )}
                <hr className="my-1 border-border" />
                <button
                  onClick={() => { logout(); setDropdownOpen(false); }}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-500 hover:bg-background transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Вийти
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="px-5 py-2.5 text-sm font-semibold text-white bg-green-500 hover:bg-green-600 rounded-sm transition-colors"
            >
              Увійти
            </Link>
            <Link
              href="/register"
              className="hidden sm:inline-flex px-5 py-2.5 text-sm font-semibold text-fg border border-border-strong hover:border-fg-subtle rounded-sm transition-colors"
            >
              Зареєструватися
            </Link>
          </div>
        )}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border bg-white animate-fade-in">
          <nav className="px-4 py-4 space-y-1">
            {[
              { href: '/', label: 'Головна' },
              { href: '/catalog?sourceRegion=UKRAINE', label: 'Авто в Україні' },
              { href: '/catalog?sourceRegion=transit', label: 'Авто в дорозі' },
              { href: '/catalog?sourceRegion=USA', label: 'Авто з США' },
              { href: '/calculator', label: 'Калькулятор' },
              { href: '/news', label: 'Новини' },
              { href: '/contacts', label: 'Контакти' },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-3 py-2.5 text-fg-muted hover:text-fg hover:bg-background rounded-sm transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
