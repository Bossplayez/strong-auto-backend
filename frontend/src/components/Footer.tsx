import Image from 'next/image';
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="bg-navy-900 text-white px-4 sm:px-8 xl:pl-[100px] xl:pr-8 pt-10 sm:pt-12 pb-6">
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12 max-w-container mx-auto">
        {/* Logo */}
        <div>
          <Image src="/assets/strong-logo-on-dark.svg" alt="STRONG AUTO" width={180} height={46} />
          <nav className="mt-4 space-y-1">
            <Link href="/about" className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Про компанію
            </Link>
            <Link href="/catalog?sourceRegion=UKRAINE" className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Авто в Україні
            </Link>
            <Link href="/catalog" className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Авто на замовлення
            </Link>
          </nav>
        </div>

        {/* Column 2 */}
        <div>
          <nav className="space-y-1">
            <Link href="/catalog?sourceRegion=USA" className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Аукціон
            </Link>
            <Link href="/news" className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Новини
            </Link>
            <Link href="/calculator" className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Калькулятор
            </Link>
          </nav>
        </div>

        {/* Services */}
        <div>
          <div className="text-sm font-bold mb-3">Наші послуги</div>
          <nav className="space-y-1">
            <Link href="/catalog?sourceRegion=USA" className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Авто з США
            </Link>
            <Link href="/catalog?sourceRegion=EUROPE" className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Авто з Європи
            </Link>
            <span className="block text-sm py-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Авто для ЗСУ
            </span>
          </nav>
        </div>

        {/* Contacts */}
        <div>
          <div className="text-sm font-bold mb-3">Контакти</div>
          <div className="space-y-1 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            <p>м. Рівне, вул. Коновальця, 3а</p>
            <p>м. Тернопіль, вул. Руська, 8</p>
            <p>
              <a href="tel:+380977727878" className="text-green-400 hover:text-green-300 transition-colors">
                +380 (97) 772 78 78
              </a>
            </p>
          </div>
        </div>
      </div>

      <div
        className="mt-8 pt-4 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs max-w-container mx-auto"
        style={{ borderTop: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}
      >
        <span>&copy; 2026 strong-auto.ua</span>
        <div className="flex gap-3">
          {['Facebook', 'Instagram', 'TikTok', 'Telegram', 'YouTube'].map((name) => (
            <a
              key={name}
              href="#"
              className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
              style={{ background: 'rgba(255,255,255,0.1)' }}
              aria-label={name}
            >
              <span className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {name[0]}
              </span>
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
