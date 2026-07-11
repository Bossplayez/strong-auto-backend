export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  BLOCKED = 'BLOCKED',
}

export enum UserType {
  CUSTOMER = 'CUSTOMER',
  MANAGER = 'MANAGER',
  ADMIN = 'ADMIN',
}

export enum VehicleSourceType {
  INTERNAL = 'INTERNAL',
  COPART = 'COPART',
  IAAI = 'IAAI',
}

export enum VehicleRegion {
  USA = 'USA',
  CANADA = 'CANADA',
  UAE = 'UAE',
  EUROPE = 'EUROPE',
  KOREA = 'KOREA',
  GEORGIA = 'GEORGIA',
}

export enum VehiclePublicationStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export enum VehicleAvailabilityStatus {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  SOLD = 'SOLD',
}

export enum LeadType {
  VEHICLE_INQUIRY = 'VEHICLE_INQUIRY',
  GENERAL_INQUIRY = 'GENERAL_INQUIRY',
  CALLBACK_REQUEST = 'CALLBACK_REQUEST',
}

export enum LeadStatus {
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  CLOSED = 'CLOSED',
  SPAM = 'SPAM',
}

export enum ImportJobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum NewsStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
  TELEGRAM = 'TELEGRAM',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}
