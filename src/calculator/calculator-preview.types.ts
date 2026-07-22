export type CalculatorProvider = 'copart' | 'iaai';
export type CalculatorFuelCode = 1 | 2 | 3 | 4;
export type CalculatorBodyCode = 1 | 2 | 3 | 4;

export interface CalculatorPreviewInput {
  provider: CalculatorProvider;
  fuelType: CalculatorFuelCode;
  bodyType: CalculatorBodyCode;
  platformId: string;
  year: number;
  priceUsd: number;
  engineVolumeCc: number;
}

export interface CalculatorPreviewBreakdown {
  lotPriceUsd: number;
  auctionFeeUsd: number | null;
  usaDeliveryUsd: number | null;
  seaDeliveryUsd: number | null;
  customsClearanceUsd: number | null;
  insuranceUsd: number | null;
  bankCommissionUsd: number | null;
  dealerPriceUsd: number | null;
  forwardingUsd: number | null;
  brokerUsd: number | null;
  uaDeliveryUsd: number | null;
  totalUsd: number;
  portName: string | null;
}

export interface CalculatorPreviewAvailable {
  status: 'available';
  basis: 'buyNow' | 'currentBid';
  priceUsd: number;
  breakdown: CalculatorPreviewBreakdown;
}

export interface CalculatorPreviewUnavailable {
  status: 'unavailable';
  reason:
    | 'LOT_NOT_ELIGIBLE'
    | 'PRICE_NOT_FRESH'
    | 'LOCATION_UNAVAILABLE'
    | 'VEHICLE_DATA_UNAVAILABLE'
    | 'ENGINE_NOT_CONFIGURED'
    | 'ENGINE_UNAVAILABLE';
}

export type CalculatorPreviewResult =
  | CalculatorPreviewAvailable
  | CalculatorPreviewUnavailable;
