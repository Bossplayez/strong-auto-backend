import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const vehicles = [
  {
    title: '2021 Toyota Camry SE',
    make: 'Toyota',
    model: 'Camry',
    year: 2021,
    priceAmount: 18500,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 45000,
    bodyType: 'Sedan',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'FWD',
    vin: '4T1G11AK5MU123456',
    locationCountry: 'US',
    locationCity: 'Los Angeles',
    locationState: 'CA',
    specs: { engineVolume: '2.5L', enginePower: '203 hp', cylinders: '4', doors: '4', color: 'White' },
    media: [
      'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=800&q=80',
      'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=800&q=80',
    ],
    description: 'Toyota Camry SE 2021 року в чудовому стані. Економічний 2.5-літровий двигун, повний комплект електроніки, камера заднього виду, Apple CarPlay.',
  },
  {
    title: '2022 BMW X5 xDrive40i',
    make: 'BMW',
    model: 'X5',
    year: 2022,
    priceAmount: 42000,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 28000,
    bodyType: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: '5UXCR6C05N9B12345',
    locationCountry: 'US',
    locationCity: 'Houston',
    locationState: 'TX',
    specs: { engineVolume: '3.0L', enginePower: '335 hp', cylinders: '6', doors: '4', color: 'Black' },
    media: [
      'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800&q=80',
      'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?w=800&q=80',
    ],
    description: 'BMW X5 xDrive40i — преміальний кросовер з потужним 3.0 турбо. Панорамний дах, шкіряний салон, адаптивна підвіска, повний привід.',
  },
  {
    title: '2020 Tesla Model 3 Long Range',
    make: 'Tesla',
    model: 'Model 3',
    year: 2020,
    priceAmount: 24500,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 52000,
    bodyType: 'Sedan',
    fuelType: 'Electric',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: '5YJ3E1EA7LF123456',
    locationCountry: 'US',
    locationCity: 'San Francisco',
    locationState: 'CA',
    specs: { engineVolume: 'Electric', enginePower: '346 hp', cylinders: '-', doors: '4', color: 'Blue' },
    media: [
      'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&q=80',
      'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800&q=80',
    ],
    description: 'Tesla Model 3 Long Range з автопілотом. Запас ходу ~500 км, повний привід, скляний дах, мінімальне обслуговування.',
  },
  {
    title: '2023 Mercedes-Benz GLE 350',
    make: 'Mercedes-Benz',
    model: 'GLE 350',
    year: 2023,
    priceAmount: 48000,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 15000,
    bodyType: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: 'W1N0G8DB2PA123456',
    locationCountry: 'US',
    locationCity: 'Miami',
    locationState: 'FL',
    specs: { engineVolume: '2.0L', enginePower: '255 hp', cylinders: '4', doors: '4', color: 'Silver' },
    media: [
      'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=800&q=80',
    ],
    description: 'Mercedes-Benz GLE 350 — сучасний luxury SUV з MBUX мультимедіа, 64-кольоровим ambient-освітленням та повним пакетом безпеки.',
  },
  {
    title: '2021 Ford Mustang GT',
    make: 'Ford',
    model: 'Mustang',
    year: 2021,
    priceAmount: 29000,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 32000,
    bodyType: 'Coupe',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'RWD',
    vin: '1FA6P8CF3M5123456',
    locationCountry: 'US',
    locationCity: 'Dallas',
    locationState: 'TX',
    specs: { engineVolume: '5.0L', enginePower: '460 hp', cylinders: '8', doors: '2', color: 'Red' },
    media: [
      'https://images.unsplash.com/photo-1485291571150-772bcfc10da5?w=800&q=80',
    ],
    description: 'Ford Mustang GT з легендарним V8 5.0 Coyote. 460 к.с., спортивна підвіска, Brembo гальма, активний випуск.',
  },
  {
    title: '2022 Hyundai Tucson SEL',
    make: 'Hyundai',
    model: 'Tucson',
    year: 2022,
    priceAmount: 22000,
    sourceType: 'INTERNAL',
    sourceRegion: 'USA',
    odometerValue: 38000,
    bodyType: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: '5NMJFDAF1NH123456',
    locationCountry: 'UA',
    locationCity: 'Рівне',
    specs: { engineVolume: '2.5L', enginePower: '187 hp', cylinders: '4', doors: '4', color: 'Gray' },
    media: [
      'https://images.unsplash.com/photo-1550355291-bbee04a92027?w=800&q=80',
    ],
    description: 'Hyundai Tucson нового покоління. Стильний дизайн, двозонний клімат, 10.25" екран, повний привід.',
  },
  {
    title: '2020 Audi Q7 Premium Plus',
    make: 'Audi',
    model: 'Q7',
    year: 2020,
    priceAmount: 35000,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 55000,
    bodyType: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: 'WA1LAAF79LD012345',
    locationCountry: 'US',
    locationCity: 'Atlanta',
    locationState: 'GA',
    specs: { engineVolume: '3.0L', enginePower: '261 hp', cylinders: '6', doors: '4', color: 'White' },
    media: [
      'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=800&q=80',
    ],
    description: 'Audi Q7 Premium Plus — 7-місний сімейний кросовер з Quattro повним приводом, Virtual Cockpit та B&O аудіосистемою.',
  },
  {
    title: '2023 Kia EV6 Wind',
    make: 'Kia',
    model: 'EV6',
    year: 2023,
    priceAmount: 31000,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 12000,
    bodyType: 'Hatchback',
    fuelType: 'Electric',
    transmission: 'Automatic',
    driveType: 'RWD',
    vin: 'KNDC3DLC5P5012345',
    locationCountry: 'US',
    locationCity: 'Portland',
    locationState: 'OR',
    specs: { engineVolume: 'Electric', enginePower: '225 hp', cylinders: '-', doors: '4', color: 'Green' },
    media: [
      'https://images.unsplash.com/photo-1504215680853-026ed2a45def?w=800&q=80',
    ],
    description: 'Kia EV6 — електрокросовер на платформі E-GMP. Ультра-швидка зарядка 18 хв (10-80%), запас ходу 440 км.',
  },
  {
    title: '2019 Lexus RX 350',
    make: 'Lexus',
    model: 'RX 350',
    year: 2019,
    priceAmount: 27500,
    sourceType: 'INTERNAL',
    sourceRegion: 'UKRAINE',
    odometerValue: 68000,
    bodyType: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: '2T2BZMCA5KC123456',
    locationCountry: 'UA',
    locationCity: 'Тернопіль',
    specs: { engineVolume: '3.5L', enginePower: '295 hp', cylinders: '6', doors: '4', color: 'Black' },
    media: [
      'https://images.unsplash.com/photo-1619405399517-d7fce0f13302?w=800&q=80',
    ],
    description: 'Lexus RX 350 — преміальний комфортний кросовер. Японська надійність, шкіряний салон Mark Levinson аудіо.',
  },
  {
    title: '2022 Chevrolet Camaro LT1',
    make: 'Chevrolet',
    model: 'Camaro',
    year: 2022,
    priceAmount: 26000,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 22000,
    bodyType: 'Coupe',
    fuelType: 'Gasoline',
    transmission: 'Manual',
    driveType: 'RWD',
    vin: '1G1FE1R72N0123456',
    locationCountry: 'US',
    locationCity: 'Chicago',
    locationState: 'IL',
    specs: { engineVolume: '6.2L', enginePower: '455 hp', cylinders: '8', doors: '2', color: 'Yellow' },
    media: [
      'https://images.unsplash.com/photo-1570356528233-b442cf2de345?w=800&q=80',
    ],
    description: 'Chevrolet Camaro LT1 з V8 6.2L. Механічна 6-ступка, Brembo гальма, магнітна підвіска, Head-Up дисплей.',
  },
  {
    title: '2021 Honda CR-V EX-L',
    make: 'Honda',
    model: 'CR-V',
    year: 2021,
    priceAmount: 23000,
    sourceType: 'INTERNAL',
    sourceRegion: 'USA',
    odometerValue: 41000,
    bodyType: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: '7FARW2H82ME123456',
    locationCountry: 'US',
    locationCity: 'Newark',
    locationState: 'NJ',
    specs: { engineVolume: '1.5L', enginePower: '190 hp', cylinders: '4', doors: '4', color: 'Blue' },
    media: [
      'https://images.unsplash.com/photo-1568844293986-8d0400bd4745?w=800&q=80',
    ],
    description: 'Honda CR-V EX-L — надійний компактний кросовер. Турбо 1.5, шкіряний салон, Honda Sensing, відмінна економічність.',
  },
  {
    title: '2023 Volkswagen ID.4 Pro S',
    make: 'Volkswagen',
    model: 'ID.4',
    year: 2023,
    priceAmount: 28000,
    sourceType: 'COPART',
    sourceRegion: 'EUROPE',
    odometerValue: 18000,
    bodyType: 'SUV',
    fuelType: 'Electric',
    transmission: 'Automatic',
    driveType: 'RWD',
    vin: 'WVGDMPE27PP012345',
    locationCountry: 'DE',
    locationCity: 'Berlin',
    specs: { engineVolume: 'Electric', enginePower: '201 hp', cylinders: '-', doors: '4', color: 'White' },
    media: [
      'https://images.unsplash.com/photo-1514316454349-750a7fd3da3a?w=800&q=80',
    ],
    description: 'Volkswagen ID.4 з Європи. Запас ходу 443 км, 12" дисплей, IQ.Drive асистенти, просторий салон.',
  },
  {
    title: '2020 Mazda CX-5 Grand Touring',
    make: 'Mazda',
    model: 'CX-5',
    year: 2020,
    priceAmount: 21000,
    sourceType: 'INTERNAL',
    sourceRegion: 'UKRAINE',
    odometerValue: 58000,
    bodyType: 'SUV',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: 'JM3KFBDM5L0123456',
    locationCountry: 'UA',
    locationCity: 'Рівне',
    specs: { engineVolume: '2.5L', enginePower: '187 hp', cylinders: '4', doors: '4', color: 'Red' },
    media: [
      'https://images.unsplash.com/photo-1493238792000-8113da705763?w=800&q=80',
    ],
    description: 'Mazda CX-5 Grand Touring — водійський кросовер з преміальним салоном. KODO дизайн, Bose аудіо, шкіра Nappa.',
  },
  {
    title: '2022 Dodge Charger R/T',
    make: 'Dodge',
    model: 'Charger',
    year: 2022,
    priceAmount: 32000,
    sourceType: 'COPART',
    sourceRegion: 'USA',
    odometerValue: 25000,
    bodyType: 'Sedan',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'RWD',
    vin: '2C3CDXCT5NH123456',
    locationCountry: 'US',
    locationCity: 'Phoenix',
    locationState: 'AZ',
    specs: { engineVolume: '5.7L', enginePower: '370 hp', cylinders: '8', doors: '4', color: 'Black' },
    media: [
      'https://images.unsplash.com/photo-1612544448445-b8232cff3b6c?w=800&q=80',
    ],
    description: 'Dodge Charger R/T з HEMI V8. Потужний маслкар на кожен день — 4 двері, 370 к.с., активний випуск.',
  },
  {
    title: '2021 Subaru Outback Limited',
    make: 'Subaru',
    model: 'Outback',
    year: 2021,
    priceAmount: 24000,
    sourceType: 'INTERNAL',
    sourceRegion: 'USA',
    odometerValue: 47000,
    bodyType: 'Wagon',
    fuelType: 'Gasoline',
    transmission: 'Automatic',
    driveType: 'AWD',
    vin: '4S4BTANC5M3123456',
    locationCountry: 'US',
    locationCity: 'Denver',
    locationState: 'CO',
    specs: { engineVolume: '2.5L', enginePower: '182 hp', cylinders: '4', doors: '4', color: 'Green' },
    media: [
      'https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?w=800&q=80',
    ],
    description: 'Subaru Outback Limited — універсал для подорожей. Symmetrical AWD, EyeSight безпека, великий кліренс 220 мм.',
  },
];

const newsArticles = [
  {
    slug: 'zerovi-mytni-stavky-na-elektromobili-2026',
    status: 'PUBLISHED',
    coverUrl: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?w=800&q=80',
    translations: [
      {
        locale: 'uk',
        title: 'Нульові митні ставки на електромобілі продовжено до 2027 року',
        excerpt: 'Верховна Рада підтвердила продовження пільг на розмитнення електрокарів. Що це означає для покупців?',
        body: 'Верховна Рада України проголосувала за продовження нульових ставок акцизу та мита на імпорт електромобілів до кінця 2027 року. Це означає, що при ввезенні електрокарів власники сплачуватимуть лише 20% ПДВ від митної вартості. За оцінками експертів, це дозволяє заощадити від $2,000 до $8,000 на кожному авто порівняно з бензиновими аналогами.\n\nДля розмитнення електромобіля вам потрібно:\n- Договір купівлі-продажу\n- Технічна документація\n- Сертифікат відповідності\n- Митна декларація\n\nНаша команда Strong Auto допоможе з усіма документами та розрахунками.',
        seoTitle: 'Нульові митні ставки на електромобілі 2026-2027 | Strong Auto',
        seoDescription: 'Дізнайтесь про пільги при розмитненні електромобілів в Україні. Нульові ставки мита та акцизу продовжено до 2027 року.',
      },
    ],
  },
  {
    slug: 'yak-kupyty-avto-z-copart-pokrokova-instrukciya',
    status: 'PUBLISHED',
    coverUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800&q=80',
    translations: [
      {
        locale: 'uk',
        title: 'Як купити авто з Copart: покрокова інструкція для українців',
        excerpt: 'Повний гайд по купівлі авто на американському аукціоні Copart — від реєстрації до отримання машини в Україні.',
        body: 'Copart — найбільший аукціон битих та цілих автомобілів у США. Через нього щороку проходять мільйони транспортних засобів. Ось як купити авто через Strong Auto:\n\n1. **Вибір авто** — переглядайте наш каталог або замовте підбір\n2. **Оцінка стану** — ми надаємо повний звіт про стан кузова та механіки\n3. **Ставка на аукціоні** — робіть ставки прямо на нашому сайті\n4. **Оплата** — після перемоги на аукціоні оплачуєте вартість + збори\n5. **Доставка** — авто їде морем до Одеси (30-45 днів)\n6. **Розмитнення** — ми оформлюємо всі документи\n7. **Отримання** — забираєте авто в нашому офісі або з доставкою додому\n\nСередній термін від ставки до отримання: 45-60 днів.',
        seoTitle: 'Купити авто з Copart в Україну — інструкція | Strong Auto',
        seoDescription: 'Покрокова інструкція як купити автомобіль з аукціону Copart США та доставити в Україну. Допомога з розмитненням.',
      },
    ],
  },
  {
    slug: 'top-10-avtomobiliv-z-ssha-2026',
    status: 'PUBLISHED',
    coverUrl: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=800&q=80',
    translations: [
      {
        locale: 'uk',
        title: 'ТОП-10 найпопулярніших авто з США в Україні у 2026 році',
        excerpt: 'Рейтинг моделей, які найчастіше замовляють українці з американських аукціонів.',
        body: 'За статистикою Strong Auto, найпопулярнішими авто з США у 2026 році стали:\n\n1. **Toyota Camry** — незмінний лідер, надійність та економічність\n2. **Tesla Model 3** — завдяки нульовому миту на електрокари\n3. **BMW X5** — преміум-кросовер за доступною ціною\n4. **Ford Mustang** — мрія кожного автоентузіаста\n5. **Honda CR-V** — ідеальний сімейний кросовер\n6. **Mercedes GLE** — люкс за ціною вживаного авто в Україні\n7. **Hyundai Tucson** — відмінне співвідношення ціна/якість\n8. **Kia EV6** — сучасний електрокросовер\n9. **Chevrolet Camaro** — маслкар для цінителів\n10. **Lexus RX** — японська надійність з преміум комфортом\n\nВсі ці моделі доступні в нашому каталозі!',
        seoTitle: 'ТОП-10 авто з США в Україні 2026 | Strong Auto',
        seoDescription: 'Рейтинг найпопулярніших автомобілів з американських аукціонів в Україні. Toyota, Tesla, BMW та інші.',
      },
    ],
  },
  {
    slug: 'rozrahunok-vartosti-rozmytnennya-2026',
    status: 'PUBLISHED',
    coverUrl: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&q=80',
    translations: [
      {
        locale: 'uk',
        title: 'Як розрахувати вартість розмитнення авто у 2026 році',
        excerpt: 'Детальний розбір формул та калькулятор для розрахунку мита, акцизу та ПДВ при імпорті авто.',
        body: 'При ввезенні автомобіля в Україну потрібно сплатити три основні платежі:\n\n**1. Мито — 10%**\nНараховується на митну вартість авто (ціна + доставка)\n\n**2. Акцизний збір**\nЗалежить від обєму двигуна, типу палива та віку авто:\n- Бензин: 50 EUR за 1 см³ × коефіцієнт віку\n- Дизель: 75 EUR за 1 см³ × коефіцієнт віку\n- Електро: 1 EUR за 1 кВт·год (фактично нуль до 2027)\n\n**3. ПДВ — 20%**\nНараховується на (вартість + мито + акциз)\n\n**Приклад для Toyota Camry 2.5L, 2021, $18,500:**\n- Мито: $1,850\n- Акциз: ~$3,200\n- ПДВ: ~$4,710\n- Разом розмитнення: ~$9,760\n\nВикористовуйте наш онлайн-калькулятор для точного розрахунку!',
        seoTitle: 'Калькулятор розмитнення авто 2026 | Strong Auto',
        seoDescription: 'Розрахуйте вартість розмитнення автомобіля в Україні. Формули мита, акцизу та ПДВ з прикладами.',
      },
    ],
  },
  {
    slug: 'perevaga-awd-chy-varto-braty-povnyy-pryvid',
    status: 'PUBLISHED',
    coverUrl: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0afe?w=800&q=80',
    translations: [
      {
        locale: 'uk',
        title: 'AWD чи FWD: яку систему приводу обрати для українських доріг?',
        excerpt: 'Розбираємо переваги та недоліки повного та переднього приводу для умов України.',
        body: 'Вибір між повним (AWD) та переднім (FWD) приводом — одне з ключових рішень при купівлі авто. Давайте розберемося:\n\n**AWD (повний привід):**\n✅ Краще зчеплення на мокрій дорозі та снігу\n✅ Впевненіше проходження поганих доріг\n✅ Кращий розгін на слизькому покритті\n❌ Вища витрата палива (+10-15%)\n❌ Дорожче обслуговування\n❌ Вища ціна авто\n\n**FWD (передній привід):**\n✅ Менша витрата палива\n✅ Простіше та дешевше обслуговування\n✅ Доступніша ціна\n❌ Гірше тримає дорогу в зимових умовах\n\n**Наша рекомендація:** якщо ви живете у великому місті та їздите переважно по асфальту — FWD достатньо. Для мешканців Карпат та сільської місцевості — однозначно AWD.\n\nВ нашому каталозі є авто з обома типами приводу. Використовуйте фільтр для зручного підбору!',
        seoTitle: 'AWD чи FWD — який привід обрати | Strong Auto',
        seoDescription: 'Порівняння повного та переднього приводу для українських доріг. Переваги, недоліки та рекомендації.',
      },
    ],
  },
  {
    slug: 'yak-pereviryty-avto-pered-pokupkoyu-z-ssha',
    status: 'PUBLISHED',
    coverUrl: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=800&q=80',
    translations: [
      {
        locale: 'uk',
        title: 'Як перевірити авто перед покупкою з США: чек-лист від Strong Auto',
        excerpt: 'На що звернути увагу при виборі авто на аукціоні. Поради від наших експертів.',
        body: 'Купівля авто з аукціону потребує уважності. Ось наш чек-лист:\n\n**1. Перевірка VIN-коду**\n- Carfax або AutoCheck звіт\n- Історія ДТП та ремонтів\n- Кількість власників\n- Реальний пробіг\n\n**2. Фото та відео**\n- Всі боки кузова\n- Підкапотний простір\n- Салон та панель приладів\n- Шини та диски\n\n**3. Тип пошкоджень (якщо аукціонне)**\n- Front End — пошкодження передньої частини\n- Rear End — задньої\n- Side — бічне\n- Flood — затоплення (НЕ рекомендуємо!)\n- Theft Recovery — після угону\n\n**4. Категорія Clean Title**\n- Clean Title — чистий документ, без серйозних ДТП\n- Salvage — значні пошкодження\n- Rebuilt — відновлений після Salvage\n\n**Порада від Strong Auto:** ми робимо повну перевірку кожного авто перед тим, як виставити в каталог. Замовляйте підбір — і ми знайдемо ідеальний варіант для вас!',
        seoTitle: 'Як перевірити авто з США перед покупкою | Strong Auto',
        seoDescription: 'Чек-лист перевірки автомобіля з американського аукціону. VIN-код, фото, тип пошкоджень та рекомендації експертів.',
      },
    ],
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

async function main() {
  console.log('🗑️  Clearing old vehicles...');
  await prisma.vehicleContentTranslation.deleteMany();
  await prisma.vehicleMedia.deleteMany();
  await prisma.vehicleSpec.deleteMany();
  await prisma.vehicleSourceBinding.deleteMany();
  await prisma.vehicle.deleteMany();

  console.log('🚗 Seeding vehicles...\n');

  for (const v of vehicles) {
    const slug = slugify(v.title) + '-' + Math.random().toString(36).slice(2, 6);

    const vehicle = await prisma.vehicle.create({
      data: {
        slug,
        title: v.title,
        make: v.make,
        model: v.model,
        year: v.year,
        priceAmount: v.priceAmount,
        currency: 'USD',
        sourceType: v.sourceType as any,
        sourceRegion: v.sourceRegion as any,
        publicationStatus: 'PUBLISHED',
        availabilityStatus: 'AVAILABLE',
        isRecommended: Math.random() > 0.5,
        vin: v.vin,
        odometerValue: v.odometerValue,
        bodyType: v.bodyType,
        fuelType: v.fuelType,
        transmission: v.transmission,
        driveType: v.driveType,
        locationCountry: v.locationCountry,
        locationCity: v.locationCity,
        locationState: v.locationState,
        publishedAt: new Date(),
        specs: {
          create: {
            engineVolume: v.specs.engineVolume,
            enginePower: v.specs.enginePower,
            cylinders: v.specs.cylinders,
            doors: v.specs.doors,
            color: v.specs.color,
          },
        },
        media: {
          create: v.media.map((url, i) => ({
            sourceUrl: url,
            mediaType: 'image',
            sortOrder: i,
            isPrimary: i === 0,
          })),
        },
        contentTranslations: {
          create: [
            {
              locale: 'uk',
              title: v.title,
              description: v.description,
            },
          ],
        },
      },
    });

    console.log(`  ✅ ${vehicle.title} (${vehicle.slug})`);
  }

  console.log(`\n🎉 Seeded ${vehicles.length} vehicles!`);

  // Seed News
  console.log('\n📰 Clearing old news...');
  await prisma.newsTranslation.deleteMany();
  await prisma.news.deleteMany();

  // Get the first user as author (or create a system user)
  let author = await prisma.user.findFirst();
  if (!author) {
    const bcrypt = require('bcrypt');
    author = await prisma.user.create({
      data: {
        email: 'admin@strongauto.ua',
        passwordHash: await bcrypt.hash('admin123', 12),
        userType: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  }

  console.log('📰 Seeding news articles...\n');

  for (let i = 0; i < newsArticles.length; i++) {
    const article = newsArticles[i];
    // Create a File record for the cover image
    const coverFile = await prisma.file.create({
      data: {
        bucket: 'covers',
        storageKey: article.coverUrl,
        originalName: `cover-${article.slug}.jpg`,
        mimeType: 'image/jpeg',
        size: 0,
      },
    });

    const news = await prisma.news.create({
      data: {
        slug: article.slug,
        status: article.status as any,
        coverFileId: coverFile.id,
        authorUserId: author.id,
        seoTitle: article.translations[0].seoTitle,
        seoDescription: article.translations[0].seoDescription,
        publishedAt: new Date(Date.now() - (newsArticles.length - i) * 3 * 24 * 60 * 60 * 1000),
        translations: {
          create: article.translations.map((t) => ({
            locale: t.locale,
            title: t.title,
            excerpt: t.excerpt,
            body: t.body,
            seoTitle: t.seoTitle,
            seoDescription: t.seoDescription,
          })),
        },
      },
    });
    console.log(`  ✅ ${news.slug}`);
  }

  console.log(`\n📰 Seeded ${newsArticles.length} news articles!`);
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
