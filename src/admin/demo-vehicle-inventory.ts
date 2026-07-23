export type DemoVehicleRegion = 'UKRAINE' | 'EUROPE';

const DEMO_IMAGE_URL = '/demo-vehicle-placeholder.svg';

const ukraineModels = [
  ['Toyota', 'RAV4'], ['Volkswagen', 'Passat'], ['Skoda', 'Octavia'], ['Mazda', 'CX-5'], ['Kia', 'Sportage'],
  ['Hyundai', 'Tucson'], ['Renault', 'Megane'], ['Nissan', 'Qashqai'], ['Ford', 'Kuga'], ['Honda', 'CR-V'],
];

const europeModels = [
  ['Audi', 'A4'], ['BMW', 'X3'], ['Mercedes-Benz', 'GLC'], ['Volkswagen', 'Tiguan'], ['Volvo', 'XC60'],
  ['Peugeot', '3008'], ['Seat', 'Ateca'], ['Cupra', 'Formentor'], ['Toyota', 'Corolla'], ['Skoda', 'Kodiaq'],
];

const ukraineCities = ['Київ', 'Львів', 'Одеса', 'Дніпро', 'Вінниця'];
const europeLocations = [
  ['Germany', 'Berlin'], ['Poland', 'Warsaw'], ['Netherlands', 'Rotterdam'], ['Belgium', 'Antwerp'], ['Czech Republic', 'Prague'],
];

export interface DemoVehicleSeed {
  slug: string;
  sourceRegion: DemoVehicleRegion;
  title: string;
  make: string;
  model: string;
  year: number;
  priceAmount: number;
  currency: 'UAH' | 'EUR';
  odometerValue: number;
  bodyType: 'SUV' | 'Sedan' | 'Hatchback' | 'Wagon';
  fuelType: 'Gasoline' | 'Diesel' | 'Hybrid';
  transmission: 'Automatic' | 'Manual';
  driveType: 'FWD' | 'AWD';
  locationCountry: string;
  locationCity: string;
  description: string;
}

function demoVehicle(region: DemoVehicleRegion, index: number): DemoVehicleSeed {
  const [make, model] = (region === 'UKRAINE' ? ukraineModels : europeModels)[index % 10];
  const year = 2017 + (index % 8);
  const country = region === 'UKRAINE' ? 'Ukraine' : europeLocations[index % europeLocations.length][0];
  const city = region === 'UKRAINE' ? ukraineCities[index % ukraineCities.length] : europeLocations[index % europeLocations.length][1];
  const bodyType = index % 3 === 0 ? 'SUV' : index % 3 === 1 ? 'Sedan' : 'Hatchback';
  const currency = region === 'UKRAINE' ? 'UAH' : 'EUR';
  const priceAmount = region === 'UKRAINE' ? 540000 + index * 18500 : 11800 + index * 650;

  return {
    slug: `demo-${region.toLowerCase()}-${String(index + 1).padStart(2, '0')}`,
    sourceRegion: region,
    title: `${year} ${make} ${model}`,
    make,
    model,
    year,
    priceAmount,
    currency,
    odometerValue: 34000 + index * 9700,
    bodyType,
    fuelType: index % 4 === 0 ? 'Hybrid' : index % 2 === 0 ? 'Gasoline' : 'Diesel',
    transmission: index % 5 === 0 ? 'Manual' : 'Automatic',
    driveType: index % 3 === 0 ? 'AWD' : 'FWD',
    locationCountry: country,
    locationCity: city,
    description: 'Демо-оголошення для перевірки вигляду каталогу. Це не пропозиція до продажу.',
  };
}

export function demoVehicleInventory() {
  return (['UKRAINE', 'EUROPE'] as const).flatMap((region) =>
    Array.from({ length: 20 }, (_, index) => demoVehicle(region, index)),
  );
}

export { DEMO_IMAGE_URL };
