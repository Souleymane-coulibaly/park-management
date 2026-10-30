import type {
  BusinessType,
  DiningZoneKind,
  MemberRole,
  OpeningVerdict,
  OrderChannel,
  Permission,
  PreparationStatus,
  QrOrderStatus,
  ReservationStatus,
  ScanRefusalReason,
  StockMovementKind,
  StockUnit,
  SubscriptionStatus,
  TableStatus,
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
  imageUrl: string | null;
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
  /** Restaurant : instruction de préparation. */
  notes?: string | null;
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
  preparationStatus: PreparationStatus;
  total: number;
  createdAt: string;
  cancelledAt: string | null;
  cashSessionId: string;
  activity: 'RESTAURANT' | 'PARK';
  channel: OrderChannel | null;
  notes: string | null;
  sentToKitchenAt: string | null;
  preparationStartedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  /** Remise fidélité déjà déduite du total, et points utilisés. */
  loyaltyDiscount: number;
  loyaltyPointsRedeemed: number;
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  } | null;
  establishment: { id: string; name: string };
  table: { id: string; name: string } | null;
  zone: { id: string; name: string } | null;
  cashier: { id: string; name: string };
  lines: (QuoteLine & { id: string })[];
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
  kitchenPrinter: boolean;
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

// ─── Sprint 5 : restaurant ───

export type { OrderChannel, PreparationStatus };

export interface RestaurantEstablishment {
  id: string;
  name: string;
}

export interface OrderEvent {
  type: string;
  fromStatus: PreparationStatus | null;
  toStatus: PreparationStatus | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  actorName: string | null;
}

export type OrderDetail = Sale & { events: OrderEvent[] };

export interface TransitionResult<T> {
  changed: boolean;
  order: T;
}

/** Commande vue par la cuisine : aucun prix. */
export interface KitchenOrder {
  id: string;
  number: number;
  channel: OrderChannel | null;
  notes: string | null;
  preparationStatus: PreparationStatus;
  sentToKitchenAt: string | null;
  preparationStartedAt: string | null;
  readyAt: string | null;
  table: { name: string } | null;
  zone: { name: string } | null;
  lines: {
    id: string;
    productName: string;
    variantName: string;
    quantity: number;
    notes: string | null;
  }[];
}

export interface DiningZone {
  id: string;
  name: string;
  kind: DiningZoneKind;
  sortOrder: number;
  isActive: boolean;
  qrPath: string;
}

export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  isActive: boolean;
  zoneId: string | null;
  status: TableStatus;
  activeOrders: number;
  qrPath: string;
}

export interface DiningOverview {
  zones: DiningZone[];
  tables: DiningTable[];
}

export interface QrRequestLine {
  variantId: string;
  quantity: number;
  notes: string | null;
  productName: string;
  variantName: string;
  unitPrice: number;
}

export interface QrRequest {
  id: string;
  status: QrOrderStatus;
  customerName: string | null;
  notes: string | null;
  lines: QrRequestLine[];
  estimatedTotal: number;
  rejectedReason: string | null;
  createdAt: string;
  saleId: string | null;
  location: string;
  /** Origine : QR code de table/zone ou borne libre-service (numéro affiché au client). */
  source: 'QR' | 'KIOSK';
  displayNumber: number | null;
}

export interface PublicMenu {
  establishmentName: string;
  location: string;
  categories: {
    id: string;
    name: string;
    products: {
      id: string;
      name: string;
      description: string | null;
      variants: { id: string; name: string; price: number }[];
    }[];
  }[];
}

export interface PublicOrderStatus {
  status: QrOrderStatus;
  rejectedReason: string | null;
  estimatedTotal: number;
  createdAt: string;
  establishmentName: string;
  location: string;
  lines: { productName: string; variantName: string; quantity: number; notes: string | null }[];
  order: {
    number: number;
    cancelled: boolean;
    total: number;
    paymentStatus: 'UNPAID' | 'PAID';
    preparationStatus: PreparationStatus;
  } | null;
}

export interface StockItem {
  id: string;
  name: string;
  unit: StockUnit;
  quantity: number;
  alertThreshold: number | null;
  unitCost: number | null;
  isActive: boolean;
  low: boolean;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  kind: StockMovementKind;
  quantity: number;
  quantityAfter: number;
  unitCost: number | null;
  reason: string | null;
  saleId: string | null;
  saleNumber: number | null;
  createdAt: string;
  actorName: string | null;
  stockItem: { id: string; name: string; unit: StockUnit };
}

export interface Recipe {
  variantId: string;
  components: { stockItemId: string; name: string; unit: StockUnit; quantity: number }[];
}

export interface Reservation {
  id: string;
  customerName: string;
  customerPhone: string | null;
  partySize: number;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  notes: string | null;
  createdAt: string;
  table: { id: string; name: string } | null;
  zone: { id: string; name: string } | null;
}

export interface RestaurantDashboard {
  date: string;
  establishment: { id: string; name: string };
  revenueCollected: number;
  paidSales: number;
  orders: number;
  averageBasket: number | null;
  waiting: number;
  inPreparation: number;
  qrPending: number;
  averagePreparationMinutes: number | null;
  topProducts: { productName: string; quantity: number; revenue: number }[];
  stockAlerts: {
    id: string;
    name: string;
    unit: StockUnit;
    quantity: number;
    alertThreshold: number;
  }[];
}

// ─── Sprint 6 : bornes, CRM, fidélité, planning ───

export type LoyaltyActivityType = 'PARK' | 'RESTAURANT';

export interface CustomerWallet {
  activity: LoyaltyActivityType;
  balance: number;
}

export interface CustomerSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  marketingConsent: boolean;
  lastVisitAt: string | null;
  anonymizedAt: string | null;
  wallets: CustomerWallet[];
  /** Présents uniquement avec l'accès complet (responsables). */
  visits?: number;
  totalSpent?: number;
}

export interface CustomerDetail extends CustomerSummary {
  notes?: string | null;
  consentAt?: string | null;
  marketingConsentAt?: string | null;
  createdAt?: string;
  purchases?: {
    id: string;
    number: number;
    activity: LoyaltyActivityType;
    total: number;
    loyaltyDiscount: number;
    createdAt: string;
    establishment: { name: string };
  }[];
  loyaltyMovements?: {
    id: string;
    kind: 'EARN' | 'REDEEM' | 'ADJUST' | 'REVERSAL';
    points: number;
    balanceAfter: number;
    reason: string | null;
    createdAt: string;
    activity: LoyaltyActivityType;
  }[];
}

export interface LoyaltyRule {
  activity: LoyaltyActivityType;
  isActive: boolean;
  earnAmountStep: number;
  redeemValue: number;
  minRedeemPoints: number;
}

export interface KioskDevice {
  id: string;
  name: string;
  isActive: boolean;
  status: 'PAIRED' | 'AWAITING_PAIRING' | 'UNPAIRED' | 'REVOKED';
  pairedAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  tokenExpiresAt: string | null;
  pairingCodeExpiresAt: string | null;
  createdAt: string;
  establishment: { id: string; name: string };
}

export interface KioskMenu {
  establishmentName: string;
  categories: {
    id: string;
    name: string;
    products: {
      id: string;
      name: string;
      description: string | null;
      imageUrl: string | null;
      variants: { id: string; name: string; price: number }[];
    }[];
  }[];
}

export interface StaffPosition {
  id: string;
  name: string;
  kind: 'CASHIER' | 'KITCHEN' | 'ENTRANCE' | 'SURVEILLANCE' | 'CLEANING' | 'OTHER';
  isActive: boolean;
}

export interface StaffMember {
  membershipId: string;
  role: MemberRole;
  name: string;
}

export interface StaffAssignment {
  id: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  establishment: { id: string; name: string };
  position: { id: string; name: string; kind: StaffPosition['kind'] };
  employee: { membershipId: string; role: MemberRole; name: string };
}
