import {
  BookOpen,
  Boxes,
  Building2,
  CreditCard,
  CalendarClock,
  CalendarDays,
  Calculator,
  ChefHat,
  HeartHandshake,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  MonitorSmartphone,
  Receipt,
  ScanLine,
  Settings,
  Ticket,
  Users,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  ticketing: Ticket,
  'gate-control': ScanLine,
  pos: Calculator,
  catalog: BookOpen,
  orders: Receipt,
  kitchen: ChefHat,
  stock: Boxes,
  reservations: CalendarClock,
  tables: LayoutGrid,
  kiosks: MonitorSmartphone,
  crm: HeartHandshake,
  'hr-planning': CalendarDays,
  employees: Users,
  settings: Settings,
  'platform-overview': LayoutDashboard,
  'platform-organizations': Building2,
  'platform-subscriptions': CreditCard,
};

export function ModuleIcon({
  moduleKey,
  className = 'h-[18px] w-[18px]',
}: {
  moduleKey: string;
  className?: string;
}) {
  const Icon = ICONS[moduleKey] ?? LayoutDashboard;
  return <Icon className={className} aria-hidden />;
}
