import type { BusinessType, MemberRole, Permission, SubscriptionStatus } from '@ocall/shared';

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
