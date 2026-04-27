# Strong Auto Design System

> **Strong Auto** (strong-auto.ua) is a Ukrainian car import marketplace. Customers can browse cars in three states — *в Україні* (already in Ukraine), *в дорозі* (in transit from abroad), *з США / з Європи* (auction listings to bid on) — and a "Розрахуйте вартість" calculator estimates total landed cost in 30 seconds.

This design system documents the visual language, components, and screens of the existing strong-auto.ua product. It was built by **observation from screenshots** of the live site, not from source code or a Figma file — see *Caveats* below.

---

## Sources

- **Reference screenshots:** 8 PNGs in `uploads/` (homepage, search, listing details for "в Україні" / "в дорозі" / auction, calculator widget). Captured 2026-04-27.
- **Live site:** https://strong-auto.ua (not crawled — visual recreation only)
- **No codebase, no Figma, no brand book** were provided.

---

## Index

| File / folder | Contents |
|---|---|
| `README.md` | This file. |
| `SKILL.md` | Agent-Skills compatible entry point. |
| `colors_and_type.css` | Tokens — green + navy palette, Oswald display + Inter body, spacing, radii. |
| `assets/` | Recreated logo (`logo.svg`, `logo-on-dark.svg`, `logo-mark.svg`). |
| `preview/` | Card files registered in the Design System tab. |
| `ui_kits/strong-auto/` | Click-thru React/JSX recreation. Open `index.html`. |

---

## Brand at a glance

- **Name:** Strong Auto · STRONG AUTO.UA
- **Audience:** Ukrainian buyers importing cars from US/EU auctions or buying already-imported stock.
- **Vibe:** **Confident, industrial, no-nonsense.** Heavy condensed type. Bright green = action. Dark navy = inventory.
- **Language:** Ukrainian.

---

## Content fundamentals

### Voice
- **Direct and operational.** The product is logistics-heavy (auctions, shipping, customs) — copy reads like an operator talking, not a marketer. No exclamation marks, no hype.
- **Address user as "ви"** (formal "you") — the site handles real money transactions, formal register fits.
- **No emoji** anywhere.
- **All-caps for chrome labels** (eyebrow tags, status: "АВТО В УКРАЇНІ", "АВТО В ДОРОЗІ", "АВТО З США", "ТОРГ", "ДОСТАВКА У ВАШЕ МІСТО"). Sentence-case for body and headings (except display titles which are often title-cased — e.g. *"Авто з США та Європи"*).
- **Prices in USD with $ prefix** (`$12 000`, `$21 900`) — this is unusual for a Ukrainian site but true to Strong Auto: import costs are quoted in dollars.
- **Numbers** with non-breaking-space thousands: `180 000 км`, `12 000`.

### Examples (from observed UI)
| Surface | Copy |
|---|---|
| Hero title | *"Авто з США та Європи"* |
| Hot listings header | *"Гарячі пропозиції"* |
| Price tag | *$12 000* (green border, green text) |
| Card CTA | *"Детальніше"* (full-width green button) |
| Show more | *"Показати більше"* (outlined button) |
| Filter actions | *"Очистити фільтри"* / *"Розширені фільтри"* |
| Search CTA | *"Показати 1 333 033 авто"* |
| Calculator title | *"Розрахуйте вартість авто за 30 секунд"* |
| Calc empty state | *"Заповніть форму — Виберіть параметри авто та натисніть кнопку розрахунку…"* |
| Auction CTA | *"Конкурувати за аукціон"* / *"Додати в обране"* |
| In-Ukraine CTA | *"(044) XXX-XX-XX"* / *"або Отримати контакт продавця"* |

---

## Visual foundations

### Color
- **Primary green** `#22c55e` — every primary CTA, every price tag border, every active filter accent. Used aggressively. This is the brand color.
- **Dark navy** `#1c2230` — photo placeholders, auction images, calculator card background, footer, active filter chip fill.
- **Page background** `#f3f4f5` — light cool gray. Cards sit white on top.
- **Heading text** very dark navy `#0f1116` — almost black.
- **No gradients.** No purple/pink. No second accent color. Only green + navy + neutrals.

### Type
- **Display:** **Oswald 700** (Google Fonts) — heavy condensed sans, used for car titles ("Nissan Sentra 2018"), VIN displays, page H1s. The original looks like a custom Antonio/Oswald hybrid; **Oswald is a substitution — flag for review.**
- **Body:** **Inter 400/500/600/700** (Google Fonts) — clean humanist sans for everything non-display. Original may use a custom face — Inter is the closest free match.
- **Mono:** JetBrains Mono — for VIN, lot numbers.
- Display sizes are LARGE — H1 is 56–72px, car titles are 44–56px.

### Spacing & layout
- **4px base grid.**
- **Container 1200px max**, with 24px gutter.
- **Layout pattern:** persistent left icon rail (76px wide) + content. Top nav above. Most pages have a sticky header.
- **Card grid:** 3-up at desktop for listings.

### Backgrounds & surfaces
- **Default page bg:** `#f3f4f5` (cool light gray, not pure white).
- **Cards:** white, 8px radius, no shadow — separated from bg by color contrast alone.
- **Photo placeholders:** dark navy `#1c2230` filled blocks with a tiny eyebrow tag in the top-left corner ("АВТО В УКРАЇНІ" etc.).
- **No textures, no gradients, no patterns.**

### Borders & elevation
- **Borders:** mostly absent. Cards use color contrast (white on gray bg) instead of borders.
- **Where borders appear:** input fields (1px `--border-strong`), price tag (2px green), filter chip outline.
- **Shadows:** minimal — only on dropdowns and modals. Cards do NOT have shadow.
- **Focus rings:** 3px green at 30% opacity.

### Corners
- **8px** (`--r-md`) is the default — buttons, cards, photo blocks, inputs, filter chips. Strong Auto barely uses any other radius. Pills are reserved for status badges in some places.

### Motion
- **Minimal** — site feels static. Hover states change colors only, no scale, no movement.
- 140ms color transitions max.

### Imagery
- **Real auction photography** — bright, daylight, three-quarter angles. We don't have access — placeholders are flat dark navy in the kit.

### Layout rules
- **Persistent left rail** with vertical icons + tiny labels (Головна, Аукціон, Авто в дорозі, Авто з США, Новини, Про компанію, Контакти).
- **Sticky top header** with logo, nav (Купити, Послуги, Про, Контакти), language switcher, login + register buttons.

---

## Iconography

- **Library:** **Lucide** via CDN — closest free match to the simple line icons in the original (`car`, `gauge`, `fuel`, `cog`, `map-pin`, `phone`, `heart`, `home`, `gavel`, `truck`, `newspaper`, `info`).
- **Stroke:** 2px (Lucide default), 20–22px sized in left rail, 16–18px inline.
- The original site likely uses a custom icon set or Iconify; Lucide is a substitution — **flag for review.**

---

## Caveats & open questions

- **Built from screenshots, not source.** Pixel measurements and exact hex values are estimated. Ask me to revise once you provide source.
- **Display font is a substitution.** Oswald is the closest free face. The original may be Antonio, Druk Wide, or a custom commission. If you have access to the actual font, drop it into `fonts/` and update `colors_and_type.css`.
- **Body font is a substitution.** Inter substitutes whatever the original uses. Replace if known.
- **Icons are Lucide.** The original may use a different set.
- **Auction flow details are guessed** — I see "Поточна ставка $21 900", spec table, and "Конкурувати за аукціон" button but don't know the bidding mechanic. Treated as a one-shot button in the kit.
- **No real product photography.** UI kit uses flat dark navy placeholders matching the screenshot style.
- **Mobile** is not specified.
