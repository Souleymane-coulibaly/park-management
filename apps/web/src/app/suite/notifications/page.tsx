import { requireMemberSession } from '@/lib/server-api';
import { SuiteNotificationsCenter } from './notifications-center';

export const dynamic = 'force-dynamic';

/** Centre de notifications du portail Ocall Suite : les notifications du compte connecté. */
export default async function SuiteNotificationsPage() {
  await requireMemberSession();
  return <SuiteNotificationsCenter />;
}
