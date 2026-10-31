import type {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  InvoiceLineKind,
  InvoiceStatus,
  PlatformPermission,
  PlatformRole,
  PlatformRoleName,
  SaasProductStatus,
  SubscriptionPaymentMethod,
  SubscriptionPaymentStatus,
  SiteContent,
  SiteDomainStatus,
  SiteMediaKind,
  SiteStatus,
  SiteTheme,
  AiFeature,
  BusinessType,
  DiningZoneKind,
  ImportIssue,
  MemberRole,
  OpeningVerdict,
  OrderChannel,
  Permission,
  PreparationStatus,
  PrinterConnection,
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
    platformRole: PlatformRole | null;
  };
  organization: { id: string; name: string; businessType: BusinessType; timezone: string } | null;
  role: MemberRole | PlatformRole | null;
  permissions: Permission[];
  /** Permissions des comptes internes Ocall (vide pour un membre d'organisation). */
  platformPermissions: PlatformPermission[];
  /** Second facteur : requis (rôle interne sensible), enrôlé, validé pour la session. */
  mfa: { required: boolean; enrolled: boolean; verified: boolean };
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
  /** Métier Ocall Park couvert ; null pour l'offre d'un autre produit Ocall Suite. */
  businessType: BusinessType | null;
  name: string;
  monthlyPrice: number;
  /** Frais de mise en service unique (FCFA), réglés hors plateforme. */
  setupFee: number;
  currency: string;
  isActive?: boolean;
  /** Quotas de l'offre (Sprint 11B), renvoyés à l'administration. */
  aiMonthlyCallQuota?: number;
  storageQuotaMb?: number;
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

export type PrinterConnectionType = PrinterConnection;

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
  /** Imprimante des tickets de commande (poste de l'établissement), ou null. */
  printerTerminal: { id: string; name: string; printerConnection: PrinterConnectionType } | null;
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

// ─── Sprint 8 : intelligence artificielle ───

export interface AiStatus {
  configured: boolean;
  simulated: boolean;
  features: Record<AiFeature, boolean>;
  usage: { used: number; limit: number; alert: boolean; exceeded: boolean };
}

export interface AiSettings {
  catalogImportEnabled: boolean;
  ticketImportEnabled: boolean;
  copilotEnabled: boolean;
  voiceOrderEnabled: boolean;
  monthlyCallLimit: number;
  alertPercent: number;
  retentionDays: number;
  /** Plafond fixé par Ocall (offre ou dérogation) : lecture seule. */
  platformLimit?: number;
}

export interface AiUsageReport {
  since: string;
  provider: string | null;
  usdXofRate: number;
  costIsEstimate: true;
  unestimatedCalls: number;
  rows: Array<{
    feature: AiFeature;
    establishmentId: string | null;
    establishmentName: string | null;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
    calls: number;
    inputTokens: number;
    outputTokens: number;
    audioSeconds: number;
    estimatedCostMicroUsd: number;
    estimatedCostXof: number;
  }>;
}

export interface AiImportCatalogLine {
  index: number;
  name: string;
  description: string | null;
  category: string | null;
  sourceText: string;
  availability: 'available' | 'unavailable' | null;
  variants: Array<{ name: string; price: number | null; priceText: string | null }>;
  issues: ImportIssue[];
  duplicateOf: { id: string; name: string } | null;
}

export interface AiImportTicketLine {
  index: number;
  name: string;
  kind: TicketKind;
  price: number | null;
  priceText: string | null;
  peopleIncluded: number;
  conditions: string | null;
  sourceText: string;
  issues: ImportIssue[];
  duplicateOf: { id: string; name: string } | null;
}

export interface AiImport<L = AiImportCatalogLine | AiImportTicketLine> {
  id: string;
  kind: 'CATALOG' | 'TICKETS';
  status: 'ANALYZED' | 'FAILED' | 'PUBLISHED' | 'DISCARDED';
  establishmentId: string;
  establishmentName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  result: { readable: boolean; currency: string | null; warnings: string[]; lines: L[] } | null;
  publication: {
    created: Array<{ index: number; id: string; name: string }>;
    skipped: number[];
    error?: string;
  } | null;
  errorCode: string | null;
  createdAt: string;
  publishedAt: string | null;
  expiresAt: string;
  purgedAt: string | null;
}

export interface CopilotResult {
  tool: string;
  title: string;
  period: { label: string; from: string; to: string } | null;
  data: Record<string, unknown>;
  missing: string[];
}

export interface CopilotAnswer {
  question: string;
  establishment: { id: string; name: string };
  answer: string;
  grounded: boolean;
  results: CopilotResult[];
  rejected: Array<{ name: string; reason: string }>;
}

export interface VoiceOrderDraft {
  id: string;
  establishmentId: string;
  status: 'DRAFT' | 'CONFIRMED' | 'DISCARDED';
  transcript: string | null;
  proposal: {
    lines: Array<{
      heard: string;
      variantId: string | null;
      label: string | null;
      unitPrice: number | null;
      quantity: number | null;
      note: string | null;
      issues: Array<'PRODUCT_NOT_FOUND' | 'QUANTITY_UNCERTAIN' | 'UNCERTAIN'>;
    }>;
    table: { id: string; name: string } | null;
    tableHeard: string | null;
    tableNotFound: boolean;
  } | null;
  saleId: string | null;
}

// ─── Sites vitrines (Sprint 10) ───

export interface SiteDomainView {
  id: string;
  hostname: string;
  status: SiteDomainStatus;
  verifiedAt: string | null;
  activatedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  dns: { txtName: string; txtValue: string; cnameName: string; cnameTarget: string | null };
}

export interface SiteEditorView {
  id: string;
  establishment: { id: string; name: string; businessType: BusinessType };
  slug: string;
  status: SiteStatus;
  isOnline: boolean;
  theme: SiteTheme;
  primaryColor: string;
  accentColor: string | null;
  draft: SiteContent;
  draftUpdatedAt: string;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  publicUrl: string;
  fallbackUrl: string;
  availableByPlan: boolean;
  domains: SiteDomainView[];
  warnings?: string[];
}

export interface SiteOverviewEntry {
  id: string;
  name: string;
  businessType: BusinessType;
  suggestedSlug: string;
  site: { id: string; slug: string; isOnline: boolean; publishedAt: string | null } | null;
}

export interface SiteMediaView {
  id: string;
  kind: SiteMediaKind;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  alt: string;
  isPublished: boolean;
  createdAt: string;
  url: string;
}

export interface SiteCatalogOptions {
  products: { id: string; name: string; category: string; price: number }[];
  tickets: { id: string; name: string; price: number; peopleIncluded: number }[];
}

// ─── Sprint 11A : Ocall Suite (administration centrale) ───

export interface SuiteProduct {
  id: string;
  code: string;
  name: string;
  description: string;
  status: SaasProductStatus;
  features: string[];
  sortOrder: number;
  plans: {
    id: string;
    name: string;
    monthlyPrice: number;
    setupFee: number;
    isActive: boolean;
    businessType: BusinessType | null;
  }[];
  subscriptions: number;
}

export interface SuiteOrganization {
  id: string;
  name: string;
  code: string;
  businessType: BusinessType;
  countryCode: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  establishments: {
    id: string;
    name: string;
    businessType: BusinessType;
    city: string | null;
    isActive: boolean;
    publicSite: { slug: string; isOnline: boolean } | null;
  }[];
  subscriptions: {
    id: string;
    status: SubscriptionStatus;
    startedAt: string | null;
    expiresAt: string | null;
    agreedSetupFee: number | null;
    agreedMonthlyPrice: number | null;
    agreedAt: string | null;
    product: { id: string; code: string; name: string; status: SaasProductStatus };
    plan: { id: string; name: string; setupFee: number; monthlyPrice: number };
  }[];
  invoices: {
    id: string;
    number: string;
    status: InvoiceStatus;
    total: number;
    issuedAt: string;
    dueAt: string | null;
    paidAt: string | null;
    product: { code: string };
  }[];
  subscriptionPayments: {
    id: string;
    amount: number;
    method: SubscriptionPaymentMethod;
    status: SubscriptionPaymentStatus;
    paidAt: string;
    invoiceId: string | null;
  }[];
  _count: { memberships: number };
}

export interface SuiteInvoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  total: number;
  currency: string;
  issuedAt: string;
  dueAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  organization: { id: string; name: string };
  product: { code: string; name: string };
  lines: {
    kind: InvoiceLineKind;
    label: string;
    quantity: number;
    unitAmount: number;
    amount: number;
    reason: string | null;
  }[];
  payments: { id: string; amount: number; status: SubscriptionPaymentStatus }[];
}

export interface InternalUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  loginId: string;
  role: PlatformRoleName | null;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PlatformAuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: string | null;
}

// ─── Sprint 11B : exploitation Ocall Suite ───

export type QuotaSource = 'override' | 'plan' | 'default';

export interface PlatformAiUsage {
  period: { from: string; to: string };
  provider: 'none' | 'simulated' | 'openai';
  usdXofRate: number;
  totals: { calls: number; estimatedCostUsd: number };
  rows: {
    organization: { id: string; name: string };
    product: { code: string; name: string } | null;
    plan: string | null;
    calls: number;
    failed: number;
    estimatedCostUsd: number;
    features: Partial<Record<AiFeature, number>>;
    establishments: { id: string | null; name: string; calls: number }[];
    monthUsed: number;
    monthQuota: number;
    quotaSource: QuotaSource;
  }[];
}

export interface PlatformStorage {
  driver: 'local' | 's3';
  healthy: boolean;
  totalMb: number;
  expiredFiles: number;
  rows: {
    organization: { id: string; name: string };
    product: { code: string; name: string } | null;
    plan: string | null;
    usedBytes: number;
    usedMb: number;
    quotaMb: number;
    siteMediaBytes: number;
    privateBytes: number;
    files: number;
    quotaSource: QuotaSource;
    percent: number;
  }[];
}

export interface PlatformSettings {
  environment: string;
  ai: { provider: string; models: Record<string, string> };
  storage: { driver: string; healthy: boolean; bucket: string | null };
  security: {
    mfaConfigured: boolean;
    cookieSecure: boolean;
    sessionTtlHours: number;
    accountLockThreshold: number;
  };
  sites: { publicOrigin: string; baseDomain: string | null; subdomainsEnabled: boolean };
  logFormat: string;
  payments: string;
}

export interface SupportAttachment {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  url: string;
  expiresAt: string;
}

export interface SupportMessageView {
  id: string;
  fromOcall: boolean;
  internal: boolean;
  body: string;
  createdAt: string;
  author: string;
  attachments: SupportAttachment[];
}

export interface SupportTicketView {
  id: string;
  number: string;
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  lastMessageAt: string;
  resolvedAt: string | null;
  createdAt: string;
  establishment: { id: string; name: string } | null;
  product: { code: string; name: string } | null;
  createdBy: { id: string; firstName: string; lastName: string };
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  organization?: { id: string; name: string };
  messages?: SupportMessageView[];
}
