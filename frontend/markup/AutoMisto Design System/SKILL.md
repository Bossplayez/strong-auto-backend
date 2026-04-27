---
name: strong-auto-design
description: Use this skill to generate well-branded interfaces and assets for Strong Auto (strong-auto.ua), a Ukrainian car import marketplace, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore `colors_and_type.css` for tokens, `assets/` for the recreated logo, and `ui_kits/strong-auto/` for the component implementations.

Hard rules to internalize before designing:
- **Two colors only:** bright green `#22c55e` (CTAs, price tags, accents) + dark navy `#1c2230` (photo blocks, headings, dark surfaces). Page background is light cool gray `#f3f4f5`. No third accent.
- **Display type is heavy condensed Oswald 700.** Body is Inter. Use Oswald for car titles, VINs, hero headings.
- **Prices in USD** (`$12 000`) — Strong Auto quotes in dollars because cars are imported.
- **Status badges** are tiny all-caps eyebrow tags positioned on photo top-left: "АВТО В УКРАЇНІ", "АВТО В ДОРОЗІ", "АВТО З США".
- **Price tag style:** green border, green text, white fill, 8px radius — placed top-right of card photo or beside title.
- **Cards have no shadow** — they sit white on light-gray bg. No borders either, separation is color contrast only.
- **No emoji. No gradients. No purple. Address user as "ви".**

If creating visual artifacts, copy assets out and create static HTML files. Always import `colors_and_type.css`. Pull components from `ui_kits/strong-auto/` rather than rebuilding.

If the user invokes this skill without other guidance, ask what they want to build, then act as an expert designer producing HTML or production code.
