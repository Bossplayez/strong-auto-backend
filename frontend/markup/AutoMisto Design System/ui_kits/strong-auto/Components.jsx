// Components.jsx — atoms & shared

const StatusTag = ({ children, variant = 'default' }) => (
  <span style={{
    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    padding: '4px 8px', borderRadius: 3, color: '#fff',
    background: variant === 'green' ? 'var(--green-500)' : 'rgba(255,255,255,0.15)',
    display: 'inline-block', whiteSpace: 'nowrap',
  }}>{children}</span>
);

const PriceTag = ({ value, size = 'md', variant = 'green' }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', background: '#fff',
    color: variant === 'green' ? 'var(--green-500)' : 'var(--navy-800)',
    border: `2px solid ${variant === 'green' ? 'var(--green-500)' : 'var(--navy-800)'}`,
    fontWeight: 700, fontFamily: 'Inter, sans-serif',
    fontSize: size === 'lg' ? 24 : size === 'sm' ? 14 : 16,
    padding: size === 'lg' ? '4px 12px' : '2px 8px',
    borderRadius: 5, whiteSpace: 'nowrap',
  }}>${value.toLocaleString('en-US').replace(/,/g, ' ')}</span>
);

const ListingCard = ({ l, onClick }) => (
  <div onClick={onClick} style={{
    background: '#fff', borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
    display: 'flex', flexDirection: 'column',
    transition: 'all 140ms',
  }}
  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.10)'}
  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
    <div style={{
      height: 170, background: 'var(--navy-800)', position: 'relative', padding: 10,
    }}>
      <StatusTag>{l.status || 'АВТО В УКРАЇНІ'}</StatusTag>
    </div>
    <div style={{ padding: '14px 16px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, lineHeight: 1.05 }}>{l.title}</div>
        <PriceTag value={l.price} size="sm" />
      </div>
      {[
        ['Двигун', l.engine || '180 000 км'],
        ['Пробіг', l.mileage || '83 568 км'],
        ['Привід', l.drive || 'Повний'],
        ['Коробка передач', l.transmission || 'Автоматична'],
      ].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', gap: 8 }}>
          <span style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{k}</span>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v}</span>
        </div>
      ))}
      <button style={{
        marginTop: 12, width: '100%', background: 'var(--green-500)', color: '#fff',
        border: 'none', padding: '10px', borderRadius: 6,
        fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
      }}>Детальніше</button>
    </div>
  </div>
);

const LeftRail = ({ active, onNav }) => {
  const items = [
    { id: 'home', icon: 'home', label: 'Головна' },
    { id: 'auction', icon: 'gavel', label: 'Аукціон' },
    { id: 'transit', icon: 'truck', label: 'Авто в дорозі' },
    { id: 'usa', icon: 'flag', label: 'Авто з США' },
    { id: 'news', icon: 'newspaper', label: 'Новини' },
    { id: 'about', icon: 'info', label: 'Про компанію' },
    { id: 'contact', icon: 'phone', label: 'Контакти' },
  ];
  return (
    <aside style={{
      position: 'fixed', left: 0, top: 0, bottom: 0, width: 76,
      background: '#fff', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 86, gap: 4, zIndex: 5,
    }}>
      <button style={{ background: 'transparent', border: 'none', padding: '8px', marginBottom: 8, cursor: 'pointer' }}>
        <i data-lucide="menu" style={{ width: 20, height: 20, color: 'var(--fg)' }}></i>
      </button>
      {items.map(it => (
        <button key={it.id} onClick={() => onNav(it.id === 'auction' ? 'auction-list' : it.id === 'usa' || it.id === 'transit' ? 'search' : 'home')} style={{
          background: active === it.id ? 'var(--neutral-100)' : 'transparent',
          border: 'none', cursor: 'pointer', padding: '10px 6px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          width: 64, borderRadius: 6, color: 'var(--fg)',
        }}>
          <i data-lucide={it.icon} style={{ width: 20, height: 20 }}></i>
          <span style={{ fontSize: 9, fontWeight: 600, textAlign: 'center', lineHeight: 1.1 }}>{it.label}</span>
        </button>
      ))}
    </aside>
  );
};

const TopHeader = ({ onNav }) => (
  <header style={{
    position: 'sticky', top: 0, zIndex: 10, background: '#fff',
    borderBottom: '1px solid var(--border)', height: 70,
    display: 'flex', alignItems: 'center', padding: '0 32px 0 100px', gap: 32,
  }}>
    <a onClick={() => onNav('home')} style={{ cursor: 'pointer' }}>
      <img src="../../assets/strong-logo.svg?v=2" width="180" height="46" alt="STRONG AUTO" />
    </a>
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginLeft: 16 }}>
      В наявності та в дорозі
    </span>
    <div style={{ flex: 1 }}></div>
    <span style={{ fontSize: 14, fontWeight: 600 }}>+380 (97) 772 76 78</span>
    <select style={{ border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, fontWeight: 600 }}>
      <option>Укр</option><option>Рус</option>
    </select>
    <button style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
      <i data-lucide="heart" style={{ width: 20, height: 20 }}></i>
    </button>
    <button onClick={() => onNav('home')} style={{
      background: 'var(--green-500)', color: '#fff', border: 'none',
      padding: '10px 22px', borderRadius: 6, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
    }}>Увійти</button>
    <button style={{
      background: '#fff', color: 'var(--fg)', border: '1px solid var(--border-strong)',
      padding: '9px 22px', borderRadius: 6, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
    }}>Зареєструватися</button>
  </header>
);

const Footer = () => (
  <footer style={{ background: 'var(--navy-900)', color: '#fff', padding: '48px 32px 24px 100px' }}>
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 48, maxWidth: 1200 }}>
      <div>
        <img src="../../assets/strong-logo-on-dark.svg?v=2" width="180" height="46" />
      </div>
      {[
        { t: 'Про компанію', i: ['Аукціон', 'Новини', 'Калькулятор'] },
        { t: 'Наші послуги', i: ['Авто з США', 'Авто з Європи', 'Авто для ЗСУ'] },
        { t: 'Контакти', i: ['м. Рівне, вул. Коновальця, 3а', 'м. Тернопіль, вул. Руська, 8', '+380 (97) 772 76 78'] },
      ].map(c => (
        <div key={c.t}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{c.t}</div>
          {c.i.map(x => <a key={x} style={{ display: 'block', fontSize: 13, padding: '4px 0', color: 'rgba(255,255,255,0.75)' }}>{x}</a>)}
        </div>
      ))}
    </div>
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 32, paddingTop: 18, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.5)', maxWidth: 1200 }}>
      <span>© 2026 strong-auto.ua</span>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ fontSize: 12 }}>fb · ig · tg</span>
      </div>
    </div>
  </footer>
);

Object.assign(window, { StatusTag, PriceTag, ListingCard, LeftRail, TopHeader, Footer });
