// Screens.jsx — Home, Search, Listing detail, Auction listing

const SAMPLE_LISTINGS = [
  { title: 'Audi Q5 2020', price: 12000, status: 'АВТО В УКРАЇНІ', mileage: '83 568 км', engine: '2.0L TFSI', drive: 'Повний', transmission: 'Автоматична' },
  { title: 'Nissan Sentra 2018', price: 8200, status: 'АВТО З США', mileage: '97 000 км', engine: '1.8L I4', drive: 'Передній', transmission: 'CVT' },
  { title: 'Hyundai Tucson 2025', price: 21900, status: 'АВТО В ДОРОЗІ', mileage: '1 240 км', engine: '2.5L MPI', drive: 'Повний', transmission: 'Автоматична' },
  { title: 'Toyota Camry 2022', price: 18500, status: 'АВТО В УКРАЇНІ', mileage: '54 200 км', engine: '2.5L Hybrid', drive: 'Передній', transmission: 'Автоматична' },
  { title: 'BMW X3 2019', price: 25400, status: 'АВТО В УКРАЇНІ', mileage: '78 900 км', engine: '2.0L Turbo', drive: 'Повний', transmission: 'Автоматична' },
  { title: 'Tesla Model 3 2023', price: 27900, status: 'АВТО З США', mileage: '23 100 км', engine: 'Electric', drive: 'Задній', transmission: '1-speed' },
  { title: 'Ford Escape 2021', price: 14300, status: 'АВТО З США', mileage: '62 400 км', engine: '1.5L EcoBoost', drive: 'Передній', transmission: 'Автоматична' },
  { title: 'Mazda CX-5 2020', price: 16800, status: 'АВТО В ДОРОЗІ', mileage: '47 500 км', engine: '2.5L Skyactiv', drive: 'Повний', transmission: 'Автоматична' },
  { title: 'VW Tiguan 2021', price: 19200, status: 'АВТО В УКРАЇНІ', mileage: '41 800 км', engine: '2.0L TSI', drive: 'Повний', transmission: 'DSG' },
];

const HeroSearch = ({ onNav }) => (
  <section style={{ background: '#fff', padding: '48px 0 32px', borderBottom: '1px solid var(--border)' }}>
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 32px' }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 56, lineHeight: 1.0, marginBottom: 8 }}>Авто з США та Європи</div>
      <div style={{ fontSize: 16, color: 'var(--fg-muted)', marginBottom: 24 }}>Прозорі ціни. Доставка та розмитнення під ключ.</div>
      <div style={{ background: 'var(--navy-800)', borderRadius: 10, padding: 20, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: 12 }}>
        {[['Тип авто','Аукціон (США)'],['Марка','Audi'],['Модель','Q5'],['Рік','2020']].map(([k,v]) => (
          <div key={k}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>{k}</div>
            <div style={{ background: '#fff', borderRadius: 6, padding: '10px 12px', fontSize: 14, fontWeight: 500 }}>{v}</div>
          </div>
        ))}
        <button onClick={() => onNav('search')} style={{
          alignSelf: 'flex-end', background: 'var(--green-500)', color: '#fff', border: 'none',
          padding: '10px 24px', borderRadius: 6, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          height: 40,
        }}>Показати 1 333 033 авто</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {['Аукціон (США)', 'Авто в дорозі', 'Авто в Україні', 'Авто з Європи', 'ЗСУ'].map((c,i) => (
          <span key={c} style={{
            fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
            background: i === 0 ? 'var(--navy-800)' : '#fff',
            color: i === 0 ? '#fff' : 'var(--fg)',
            border: i === 0 ? 'none' : '1px solid var(--border-strong)',
          }}>{c}</span>
        ))}
      </div>
    </div>
  </section>
);

const HotOffers = ({ onListing }) => (
  <section style={{ padding: '40px 32px', maxWidth: 1200, margin: '0 auto' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
      <h2 style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 36 }}>Гарячі пропозиції</h2>
      <a style={{ fontSize: 14, fontWeight: 600, color: 'var(--green-600)', cursor: 'pointer' }}>Дивитись усі →</a>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {SAMPLE_LISTINGS.slice(0, 6).map((l, i) => <ListingCard key={i} l={l} onClick={() => onListing(l)} />)}
    </div>
    <div style={{ textAlign: 'center', marginTop: 24 }}>
      <button style={{
        background: '#fff', color: 'var(--fg)', border: '1px solid var(--border-strong)',
        padding: '12px 32px', borderRadius: 6, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
      }}>Показати більше</button>
    </div>
  </section>
);

const CalculatorBlock = () => (
  <section style={{ padding: '40px 32px', maxWidth: 1200, margin: '0 auto' }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ background: 'var(--navy-800)', color: '#fff', padding: 32, borderRadius: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>Калькулятор</div>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 36, fontWeight: 700, lineHeight: 1.05, marginBottom: 12 }}>Розрахуйте вартість авто за 30 секунд</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 24 }}>Аукціонна ціна, доставка, розмитнення, страхування — все в одній сумі.</div>
        </div>
        <button style={{ background: 'var(--green-500)', color: '#fff', border: 'none', padding: '14px 28px', borderRadius: 6, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' }}>Розрахувати вартість</button>
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 8 }}>Авто в дорозі</div>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 30, fontWeight: 700, lineHeight: 1.1, marginBottom: 12 }}>Слідкуйте за авто на шляху до Києва</div>
          <div style={{ fontSize: 14, color: 'var(--fg-muted)' }}>Контейнер №KKLU 4810392 · ETA 12 травня</div>
        </div>
        <a style={{ color: 'var(--green-600)', fontWeight: 600, fontSize: 14, marginTop: 24 }}>Дивитись 168 авто в дорозі →</a>
      </div>
    </div>
  </section>
);

const HomeScreen = ({ onNav, onListing }) => (
  <div>
    <HeroSearch onNav={onNav} />
    <HotOffers onListing={onListing} />
    <CalculatorBlock />
    <Footer />
  </div>
);

// ---------------- Search ----------------

const FilterSidebar = () => {
  const Field = ({ label, children }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--fg)' }}>{label}</div>
      {children}
    </div>
  );
  const Sel = ({ value }) => (
    <div style={{ background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '9px 12px', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: value ? 'var(--fg)' : 'var(--fg-subtle)' }}>{value || 'Виберіть'}</span>
      <i data-lucide="chevron-down" style={{ width: 14, height: 14, color: 'var(--fg-muted)' }}></i>
    </div>
  );
  return (
    <aside style={{ width: 240, background: '#fff', borderRadius: 8, padding: 18, alignSelf: 'flex-start', flexShrink: 0 }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 700, marginBottom: 14 }}>Фільтри</div>
      <Field label="Марка"><Sel value="Audi" /></Field>
      <Field label="Модель"><Sel value="Q5" /></Field>
      <Field label="Рік випуску">
        <div style={{ display: 'flex', gap: 6 }}><Sel value="2018" /><Sel value="2024" /></div>
      </Field>
      <Field label="Ціна, $">
        <div style={{ display: 'flex', gap: 6 }}><Sel value="5 000" /><Sel value="40 000" /></div>
      </Field>
      <Field label="Тип кузова"><Sel /></Field>
      <Field label="Привід"><Sel /></Field>
      <Field label="Тип палива"><Sel /></Field>
      <Field label="Коробка передач"><Sel /></Field>
      <button style={{ width: '100%', background: 'var(--green-500)', color: '#fff', border: 'none', padding: '11px', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 6 }}>Застосувати</button>
      <button style={{ width: '100%', background: 'transparent', color: 'var(--fg-muted)', border: 'none', padding: '10px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>Очистити фільтри</button>
    </aside>
  );
};

const SearchScreen = ({ onListing }) => (
  <div>
    <div style={{ background: '#fff', padding: '20px 32px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 32, fontWeight: 700 }}>Авто з США та Європи</div>
      <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>Знайдено 1 333 033 авто</div>
    </div>
    <div style={{ display: 'flex', gap: 16, padding: '20px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <FilterSidebar />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['Аукціон (США)', 'Авто в дорозі', 'Авто в Україні'].map((c,i) => (
              <span key={c} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 5, background: i===0?'var(--navy-800)':'#fff', color: i===0?'#fff':'var(--fg)', border: i===0?'none':'1px solid var(--border-strong)' }}>{c}</span>
            ))}
          </div>
          <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Сортувати: <strong style={{ color: 'var(--fg)' }}>За ціною ↑</strong></span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {SAMPLE_LISTINGS.map((l, i) => <ListingCard key={i} l={l} onClick={() => onListing(l)} />)}
        </div>
      </div>
    </div>
    <Footer />
  </div>
);

// ---------------- Listing detail (in Ukraine) ----------------

const ListingScreen = ({ listing, onNav }) => {
  const l = listing || SAMPLE_LISTINGS[0];
  return (
    <div>
      <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        <a onClick={() => onNav('home')} style={{ fontSize: 13, color: 'var(--fg-muted)', cursor: 'pointer' }}>← Усі авто в Україні</a>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', margin: '12px 0 18px' }}>
          <div>
            <StatusTag>{l.status}</StatusTag>
            <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 48, fontWeight: 700, lineHeight: 1.0, marginTop: 6 }}>{l.title}</div>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: 6 }}>VIN · WBA8E9G50JNU12345 · LOT 60823472</div>
          </div>
          <PriceTag value={l.price} size="lg" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <div>
            <div style={{ background: 'var(--navy-800)', borderRadius: 8, height: 380, position: 'relative', padding: 14 }}>
              <StatusTag>{l.status}</StatusTag>
              <div style={{ position: 'absolute', bottom: 14, right: 14, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 4 }}>1 / 24</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginTop: 8 }}>
              {[...Array(6)].map((_,i) => <div key={i} style={{ background: 'var(--navy-700)', borderRadius: 4, height: 56 }}></div>)}
            </div>

            <div style={{ background: '#fff', borderRadius: 8, padding: 24, marginTop: 16 }}>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Характеристики</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 32px' }}>
                {[['Рік випуску','2020'],['Двигун',l.engine],['Пробіг',l.mileage],['Привід',l.drive],['Коробка передач',l.transmission],['Колір','Чорний'],['Тип палива','Бензин'],['Кузов','Кросовер']].map(([k,v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>{k}</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Опис від продавця</div>
                <p style={{ fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.6, margin: 0 }}>Один власник в Україні. Обслуговувався у офіційного дилера. Без ДТП, всі ТО за регламентом. Зимова та літня резина в комплекті. Можливий торг при огляді.</p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 8 }}>Продавець</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--navy-700)' }}></div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Strong Auto · Київ</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Перевірений салон · 4 роки</div>
                </div>
              </div>
              <button style={{ width: '100%', background: 'var(--green-500)', color: '#fff', border: 'none', padding: '13px', borderRadius: 6, fontWeight: 700, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>(044) XXX-XX-XX</button>
              <button style={{ width: '100%', background: '#fff', color: 'var(--fg)', border: '1px solid var(--border-strong)', padding: '12px', borderRadius: 6, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginTop: 8 }}>Отримати контакт продавця</button>
            </div>

            <div style={{ background: 'var(--navy-800)', color: '#fff', borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>Доставка</div>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Доставка у ваше місто</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 14 }}>Безкоштовно по Україні від $200 предоплати.</div>
              <a style={{ color: 'var(--green-400)', fontWeight: 600, fontSize: 13 }}>Детальніше →</a>
            </div>

            <button style={{ background: '#fff', color: 'var(--fg)', border: '1px solid var(--border-strong)', padding: '13px', borderRadius: 6, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <i data-lucide="heart" style={{ width: 16, height: 16 }}></i>Додати в обране
            </button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

// ---------------- Auction listing ----------------

const AuctionScreen = ({ onNav }) => {
  const l = { title: 'Hyundai Tucson 2025', price: 21900 };
  return (
    <div>
      <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        <a onClick={() => onNav('home')} style={{ fontSize: 13, color: 'var(--fg-muted)', cursor: 'pointer' }}>← Аукціон США</a>
        <div style={{ margin: '12px 0 18px' }}>
          <StatusTag variant="green">ТОРГ · 2 ГОД 14 ХВ</StatusTag>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 48, fontWeight: 700, lineHeight: 1.0, marginTop: 6 }}>{l.title}</div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: 6 }}>LOT 60823472 · IAAI Tampa, FL</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <div>
            <div style={{ background: 'var(--navy-800)', borderRadius: 8, height: 380, position: 'relative', padding: 14 }}>
              <StatusTag>АУКЦІОН США</StatusTag>
            </div>
            <div style={{ background: '#fff', borderRadius: 8, padding: 24, marginTop: 16 }}>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Характеристики</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 32px' }}>
                {[['Стан','Run & Drive'],['Двигун','2.5L MPI'],['Пробіг','1 240 км'],['Привід','Повний'],['Коробка передач','Автоматична'],['Тип палива','Бензин'],['Документ','Salvage TX'],['Ключ','Так']].map(([k,v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>{k}</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 4 }}>Поточна ставка</div>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 48, fontWeight: 700, color: 'var(--green-500)' }}>${l.price.toLocaleString().replace(/,/g,' ')}</div>
              <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 16 }}>3 ставки · мінімальний крок $100</div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Ваша максимальна ставка, $</div>
                <input defaultValue="22 000" style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 6, border: '1px solid var(--border-strong)', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, boxSizing: 'border-box' }} />
              </div>
              <button style={{ width: '100%', background: 'var(--green-500)', color: '#fff', border: 'none', padding: '14px', borderRadius: 6, fontWeight: 700, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' }}>Конкурувати за аукціон</button>
              <button style={{ width: '100%', background: '#fff', color: 'var(--fg)', border: '1px solid var(--border-strong)', padding: '12px', borderRadius: 6, fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <i data-lucide="heart" style={{ width: 16, height: 16 }}></i>Додати в обране
              </button>
            </div>

            <div style={{ background: 'var(--navy-800)', color: '#fff', borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>Загальна вартість</div>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 18, fontWeight: 700, marginBottom: 14 }}>З доставкою у Київ</div>
              {[['Ставка','$22 000'],['Аукціонні збори','$640'],['Доставка US→UA','$2 100'],['Розмитнення','$3 850'],['Сервіс','$500']].map(([k,v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', color: 'rgba(255,255,255,0.85)' }}>
                  <span>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 700 }}>
                <span>Разом</span><span style={{ color: 'var(--green-400)' }}>$29 090</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

Object.assign(window, { HomeScreen, SearchScreen, ListingScreen, AuctionScreen });
