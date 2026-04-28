// Enums
export type UserType = 'CUSTOMER' | 'STAFF' | 'ADMIN';
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'BLOCKED' | 'DELETED';
export type VehicleSourceType = 'INTERNAL' | 'COPART';
export type VehicleRegion = 'USA' | 'EUROPE' | 'UKRAINE';
export type VehiclePublicationStatus = 'DRAFT' | 'READY' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
export type VehicleAvailabilityStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'NOT_AVAILABLE';
export type LeadType = 'CONTACT_FORM' | 'CALLBACK' | 'CATALOG_REQUEST' | 'CALCULATOR_REQUEST' | 'SELECTION_REQUEST';
export type LeadStatus = 'NEW' | 'IN_PROGRESS' | 'QUALIFIED' | 'WON' | 'LOST' | 'SPAM' | 'ARCHIVED';
export type NewsStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

// Interfaces
export interface User {
  id: string;
  email: string;
  phone?: string;
  userType: UserType;
  status: UserStatus;
  profile?: UserProfile;
  createdAt: string;
}

export interface UserProfile {
  firstName?: string;
  lastName?: string;
  city?: string;
  preferredLanguage?: string;
}

export interface Vehicle {
  id: string;
  slug: string;
  sourceType: VehicleSourceType;
  sourceRegion: VehicleRegion;
  publicationStatus: VehiclePublicationStatus;
  availabilityStatus: VehicleAvailabilityStatus;
  vin?: string;
  make: string;
  model: string;
  year: number;
  odometer?: number;
  odometerValue?: number;
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  driveType?: string;
  damage?: string;
  damagePrimary?: string;
  location?: string;
  locationCountry?: string;
  locationCity?: string;
  priceAmount: number;
  currency: string;
  specs?: VehicleSpec;
  media: VehicleMedia[];
  contentTranslations?: VehicleContentTranslation[];
  publishedAt?: string;
  createdAt: string;
}

export interface VehicleSpec {
  engineVolume?: string;
  enginePower?: string;
  cylinders?: string;
  doors?: string;
  color?: string;
  keys?: string;
  lotNumber?: string;
  auctionDate?: string;
}

export interface VehicleMedia {
  id: string;
  url?: string;
  sourceUrl?: string;
  fileId?: string | null;
  isPrimary?: boolean;
  sortOrder: number;
}

export interface VehicleContentTranslation {
  locale: string;
  title?: string;
  description?: string;
  badge?: string;
}

export interface CalculatorEstimate {
  id: string;
  totalAmount: number;
  totalCurrency: string;
  input: CalculatorInput;
  output: CalculatorBreakdown;
  createdAt: string;
}

export interface CalculatorInput {
  priceAmount: number;
  currency: string;
  fuelType: string;
  engineVolume: number;
  year: number;
  sourceCountry?: string;
  sourceState?: string;
  destinationCity?: string;
}

export interface CalculatorBreakdown {
  auctionFee: number;
  logistics: number;
  customs: number;
  insurance: number;
  serviceFees: number;
  totalAmount: number;
  totalCurrency: string;
  exchangeRate: number;
  lines: { label: string; amount: number; currency: string }[];
}

export interface Lead {
  id: string;
  leadType: LeadType;
  status: LeadStatus;
  name: string;
  phone: string;
  email?: string;
  comment?: string;
  vehicleId?: string;
  vehicle?: Vehicle;
  calculatorEstimateId?: string;
  assignedToUserId?: string;
  assignedTo?: User;
  comments?: LeadComment[];
  statusHistory?: LeadStatusHistory[];
  createdAt: string;
}

export interface LeadComment {
  id: string;
  text: string;
  authorId: string;
  author?: User;
  createdAt: string;
}

export interface LeadStatusHistory {
  id: string;
  fromStatus: LeadStatus;
  toStatus: LeadStatus;
  changedById: string;
  createdAt: string;
}

export interface NewsArticle {
  id: string;
  slug: string;
  status: NewsStatus;
  coverImageUrl?: string;
  translations: NewsTranslation[];
  createdAt: string;
  updatedAt: string;
}

export interface NewsTranslation {
  locale: string;
  title: string;
  body: string;
  excerpt?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface VehicleFilters {
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  priceFrom?: number;
  priceTo?: number;
  mileageFrom?: number;
  mileageTo?: number;
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  driveType?: string;
  sourceType?: VehicleSourceType;
  sourceRegion?: VehicleRegion;
  availabilityStatus?: VehicleAvailabilityStatus;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateLeadDto {
  leadType: LeadType;
  name: string;
  phone: string;
  email?: string;
  comment?: string;
  vehicleId?: string;
  calculatorEstimateId?: string;
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  city?: string;
  preferredLanguage?: string;
  phone?: string;
}

export interface FilterOptions {
  makes: string[];
  models: string[];
  bodyTypes: string[];
  fuelTypes: string[];
  transmissions: string[];
  driveTypes: string[];
  yearRange: { min: number; max: number };
  priceRange: { min: number; max: number };
  mileageRange: { min: number; max: number };
}
