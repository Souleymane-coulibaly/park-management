import type {
  BusinessType,
  MemberRole,
  OpeningVerdict,
  Permission,
  ScanRefusalReason,
  SubscriptionStatus,
  TicketKind,
  TicketStatus,
} from '@ocall/shared';

/** Contrats des réponses de l'API v1 consommées par le frontend. */
export interface Me {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    loginId: string;
    mustChangePassword: boolean;
    platformRole: 'SUPER_ADMIN' | null;
  };
  organization: { id: string; name: string; businessType: BusinessType; timezone: string } | null;
  role: MemberRole | 'SUPER_ADMIN' | null;
  permissions: Permission[];
  navigation: {
    key: string;
    label: string;
    status: 'available' | 'upcoming';
    href: string | null;
  }[];
}

export interface Organization {
  id: string;
  name: string;
  code: string;
  businessType: BusinessType;
  countryCode: string;
  currency: string;
  timezone: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}

export interface Establishment {
  id: string;
  name: string;
  businessType: BusinessType;
  city: string | null;
  address: string | null;
  phone: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  _count: { assignments: number };
}

export interface Employee {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  loginId: string;
  role: MemberRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  establishments: { id: string; name: string }[];
  createdAt: string;
}

export interface RoleMatrix {
  permissions: { key: Permission; label: string }[];
  roles: { role: MemberRole; label: string; permissions: Permission[]; assignable: boolean }[];
}

export interface Plan {
  id: string;
  businessType: BusinessType;
  name: string;
  monthlyPrice: number;
  currency: string;
  isActive?: boolean;
}

export interface Subscription {
  status: SubscriptionStatus;
  startedAt: string | null;
  expiresAt: string | null;
  plan: { name: string; businessType: BusinessType; monthlyPrice: number; currency: string };
  events: {
    type: string;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}

export interface DashboardSummary {
  activities: ('PARK' | 'RESTAURANT')[];
  revenue: Record<
    'PARK' | 'RESTAURANT',
    { today: number; last30Days: number; paidSalesLast30Days: number } | null
  >;
  establishments: { total: number; active: number };
  employees: { total: number; active: number; byRole: Partial<Record<MemberRole, number>> } | null;
  subscription: {
    status: SubscriptionStatus;
    expiresAt: string | null;
    plan: { name: string; monthlyPrice: number; currency: string };
  } | null;
  recentActivity: { id: string; action: string; createdAt: string }[] | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actor: string;
  createdAt: string;
}

export interface PlatformOverview {
  organizations: {
    total: number;
    byStatus: Record<string, number>;
    byBusinessType: Record<string, number>;
  };
  subscriptions: { byStatus: Record<string, number> };
  monthlyRecurringRevenue: number;
  activeAccounts: number;
}

export interface PlatformOrganization {
  id: string;
  name: string;
  code: string;
  businessType: BusinessType;
  countryCode: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  subscription: {
    status: SubscriptionStatus;
    expiresAt: string | null;
    plan: { name: string; monthlyPrice: number };
  } | null;
  establishmentsCount: number;
  accountsCount: number;
}

export interface PlatformSubscription {
  id: string;
  status: SubscriptionStatus;
  startedAt: string | null;
  expiresAt: string | null;
  organization: { id: string; name: string; businessType: BusinessType };
  plan: { name: string; monthlyPrice: number; currency: string };
}

// ─── Sprint 2 : catalogue et caisse POS ───

export interface CatalogCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  _count: { products: number };
}

export interface CatalogVariant {
  id: string;
  name: string;
  isActive: boolean;
  prices: { establishmentId: string; price: number; isAvailable: boolean }[];
}

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  category: { id: string; name: string };
  variants: CatalogVariant[];
}

export interface PosEstablishment {
  id: string;
  name: string;
}

export interface PosCatalogCategory {
  id: string;
  name: string;
  products: { id: string; name: string; variants: { id: string; name: string; price: number }[] }[];
}

export interface QuoteLine {
  variantId: string;
  productName: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Quote {
  lines: QuoteLine[];
  total: number;
}

export interface SalePayment {
  id: string;
  method: 'CASH' | 'WAVE';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  amount: number;
  amountTendered: number | null;
  changeGiven: number | null;
  createdAt: string;
}

export interface Sale {
  id: string;
  number: number;
  status: 'OPEN' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PAID';
  preparationStatus: 'NOT_SENT' | 'SENT' | 'READY' | 'SERVED';
  total: number;
  createdAt: string;
  cancelledAt: string | null;
  cashSessionId: string;
  activity: 'RESTAURANT' | 'PARK';
  establishment: { id: string; name: string };
  cashier: { id: string; name: string };
  lines: QuoteLine[];
  payments: SalePayment[];
}

export interface PaymentResult {
  sale: Sale;
  payment: SalePayment;
}

export interface CashSession {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openingFloat: number;
  openedAt: string;
  closedAt: string | null;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
  closingNote: string | null;
  establishment: { id: string; name: string };
  openedBy: { id: string; name: string | null };
  closedBy: { id: string; name: string | null } | null;
  cashSalesTotal: number;
  salesCount: number;
  unpaidCount: number;
}

export interface PaymentMethodInfo {
  method: 'CASH' | 'WAVE';
  label: string;
  available: boolean;
  reason: string | null;
}

// ─── Sprint 3 : postes, impression et tiroir-caisse ───

export type PrinterConnectionType = 'NONE' | 'SIMULATED' | 'NETWORK' | 'BLUETOOTH' | 'USB';

export interface PosTerminal {
  id: string;
  name: string;
  isActive: boolean;
  printerConnection: PrinterConnectionType;
  printerAddress: string | null;
  paperWidth: number;
  autoPrintReceipt: boolean;
  drawerEnabled: boolean;
  drawerPin: number;
  establishment: { id: string; name: string };
}

export interface HardwareTarget {
  connection: PrinterConnectionType;
  address: string | null;
}

export interface PrintJobView {
  id: string;
  kind: 'RECEIPT' | 'REPRINT' | 'TEST';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  paperWidth: number;
  reason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  saleId: string | null;
  ticketId: string | null;
  saleNumber: number | null;
  terminalName: string;
  requestedByName: string;
}

export interface PrintJobResponse {
  job: PrintJobView;
  printer: HardwareTarget;
  paperWidth: number;
  data: string | null;
  preview: string[];
  alreadyCompleted: boolean;
}

export interface DrawerEventView {
  id: string;
  reason: 'CASH_PAYMENT' | 'MANUAL';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  paymentId: string | null;
  justification: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  terminalName: string;
  requestedByName: string;
}

export interface DrawerEventResponse {
  event: DrawerEventView;
  printer: HardwareTarget;
  command: { pin: 2 | 5 } | null;
  alreadyIssued: boolean;
}

// ─── Sprint 4 : billetterie du parc et contrôle d'accès ───

export interface ParkEstablishment {
  id: string;
  name: string;
  timezone: string;
}

export interface TicketCategory {
  id: string;
  establishmentId: string;
  kind: TicketKind;
  name: string;
  description: string | null;
  price: number;
  peopleIncluded: number;
  conditions: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  validityDays: number;
  sortOrder: number;
  isActive: boolean;
}

export interface TicketCatalog {
  today: string;
  openToday: boolean;
  status: OpeningVerdict;
  categories: TicketCategory[];
}

export interface TicketQuoteLine {
  ticketCategoryId: string;
  peoplePerUnit: number;
  visitorNames: string[];
  productName: string;
  variantName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface TicketQuote {
  lines: TicketQuoteLine[];
  total: number;
}

export interface IssuedTicket {
  id: string;
  visitorName: string;
  status: TicketStatus;
  pricePaid: number;
  validFrom: string;
  validUntil: string;
  usedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  qr: string;
  ticketCategory: { id: string; name: string; kind: TicketKind };
}

export interface ParkSchedule {
  timezone: string;
  today: string;
  status: OpeningVerdict;
  openToday: boolean;
  weekly: { weekday: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }[];
  exceptions: {
    id: string;
    date: string;
    isClosed: boolean;
    opensAt: string | null;
    closesAt: string | null;
    label: string | null;
  }[];
}

export interface TicketScanView {
  id: string;
  establishmentId: string;
  result: 'ACCEPTED' | 'REFUSED';
  refusalReason: ScanRefusalReason | null;
  entryPoint: string;
  createdAt: string;
  scannedById: string;
  scannedBy: string;
  ticket: {
    id: string;
    visitorName: string;
    categoryName: string;
    kind: TicketKind;
    status: TicketStatus;
    validUntil: string;
    usedAt: string | null;
  } | null;
}

export interface ParkDayStats {
  date: string;
  ticketsSold: number;
  cancelled: number;
  unused: number;
  entries: number;
  refused: number;
  revenue: number;
  paidSales: number;
}

export interface ParkDashboard {
  establishment: ParkEstablishment;
  today: ParkDayStats;
  yesterday: ParkDayStats;
  openToday: boolean;
  status: OpeningVerdict;
  byCategory: {
    ticketCategoryId: string;
    name: string;
    kind: TicketKind;
    tickets: number;
    amount: number;
  }[];
  byHour: { hour: number; sold: number; entries: number }[];
  recentScans: {
    id: string;
    result: 'ACCEPTED' | 'REFUSED';
    refusalReason: ScanRefusalReason | null;
    entryPoint: string;
    createdAt: string;
    visitorName: string | null;
    categoryName: string | null;
  }[];
}
