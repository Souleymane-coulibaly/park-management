'use client';

import { useState } from 'react';
import { Banknote, DoorOpen, Ticket, TicketX } from 'lucide-react';
import { SCAN_REFUSAL_LABELS, formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { describeOpening } from '@/components/park/opening';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import type { ParkDashboard, ParkEstablishment } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/*
 * Couleurs des deux séries du graphique horaire, validées (scripts/validate_palette.js du guide dataviz) :
 * vert saturé (le vert de marque #176B53 est trop peu chromatique pour une surface de données) et or savane.
 * L'or est sous 3:1 sur fond blanc : légende, info-bulles et vue tableau assurent la lecture sans la couleur.
 */
const SOLD_COLOR = '#1A7F5A';
const ENTRIES_COLOR = '#D99B38';

/** Tableau de bord du parc : journée en cours comparée à la veille, en heure locale de l'établissement. */
export default function ParkDashboardPage() {
  const seesStats = useCan('sale.read_all');
  if (!seesStats) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Tableau de bord du parc</h1>
        <ParkNav />
      </div>
      <ParkEstablishmentScope source="/ticketing/establishments">
        {(park) => <Dashboard park={park} />}
      </ParkEstablishmentScope>
    </div>
  );
}

/** Écart avec la veille, en texte (jamais la couleur seule). */
function Delta({
  today,
  yesterday,
  money = false,
}: {
  today: number;
  yesterday: number;
  money?: boolean;
}) {
  const diff = today - yesterday;
  const value = money ? formatXof(Math.abs(diff)) : Math.abs(diff).toLocaleString('fr-FR');
  return (
    <span>
      {diff === 0 ? 'Comme hier' : `${diff > 0 ? '+' : '−'}${value} par rapport à hier`}
      <span className="text-muted"> (hier : {money ? formatXof(yesterday) : yesterday})</span>
    </span>
  );
}

function Dashboard({ park }: { park: ParkEstablishment }) {
  const dash = useApi<ParkDashboard>(`/ticketing/dashboard?establishmentId=${park.id}`);
  if (dash.state === 'loading') return <LoadingState label="Calcul des indicateurs…" />;
  if (dash.state === 'error') return <ErrorState error={dash.error} onRetry={dash.reload} />;
  const { today, yesterday } = dash.data;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={dash.data.status.open ? 'forest' : 'terracotta'}>
          {describeOpening(dash.data.status)}
        </Badge>
        <span className="text-muted">
          Journée du {today.date} · heure de {dash.data.establishment.timezone}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Billets vendus aujourd’hui"
          value={<span data-testid="park-tickets-sold">{today.ticketsSold}</span>}
          hint={<Delta today={today.ticketsSold} yesterday={yesterday.ticketsSold} />}
          icon={<Ticket className="h-5 w-5" />}
        />
        <KpiCard
          label="Entrées"
          value={<span data-testid="park-entries">{today.entries}</span>}
          hint={<Delta today={today.entries} yesterday={yesterday.entries} />}
          icon={<DoorOpen className="h-5 w-5" />}
          accent="savanna"
        />
        <KpiCard
          label="Billets du jour non utilisés"
          value={today.unused}
          hint={`${today.cancelled} annulé(s) · ${today.refused} passage(s) refusé(s)`}
          icon={<TicketX className="h-5 w-5" />}
          accent="terracotta"
        />
        <KpiCard
          label="Chiffre d’affaires billetterie"
          value={<span data-testid="park-revenue">{formatXof(today.revenue)}</span>}
          hint={<Delta today={today.revenue} yesterday={yesterday.revenue} money />}
          icon={<Banknote className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <HourlyChart byHour={dash.data.byHour} />
        <Card>
          <div className="border-b border-line/70 px-4 py-3">
            <h2 className="font-semibold">Ventes par catégorie</h2>
          </div>
          {dash.data.byCategory.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Aucun billet vendu aujourd’hui.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Catégorie</th>
                  <th className="px-4 py-2 text-right font-medium">Billets</th>
                  <th className="px-4 py-2 text-right font-medium">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {dash.data.byCategory.map((c) => (
                  <tr key={c.ticketCategoryId}>
                    <td className="px-4 py-2">{c.name}</td>
                    <td className="px-4 py-2 text-right font-semibold">{c.tickets}</td>
                    <td className="px-4 py-2 text-right">{formatXof(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <div className="border-b border-line/70 px-4 py-3">
          <h2 className="font-semibold">Derniers passages</h2>
        </div>
        {dash.data.recentScans.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Aucun passage aujourd’hui.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {dash.data.recentScans.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-28 text-muted">{formatDateTime(s.createdAt)}</span>
                {s.result === 'ACCEPTED' ? (
                  <Badge tone="forest">Accepté</Badge>
                ) : (
                  <Badge tone="terracotta">
                    {s.refusalReason ? SCAN_REFUSAL_LABELS[s.refusalReason] : 'Refusé'}
                  </Badge>
                )}
                <span className="flex-1 truncate">
                  {s.visitorName ? `${s.visitorName} · ${s.categoryName}` : '—'}
                </span>
                <span className="text-muted">{s.entryPoint}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/** Colonnes groupées par heure locale (un seul axe : des nombres de billets), avec vue tableau. */
function HourlyChart({ byHour }: { byHour: ParkDashboard['byHour'] }) {
  const [asTable, setAsTable] = useState(false);
  const first = byHour[0]?.hour ?? 0;
  const last = byHour[byHour.length - 1]?.hour ?? 0;
  const hours = byHour.length
    ? Array.from(
        { length: last - first + 1 },
        (_, i) =>
          byHour.find((h) => h.hour === first + i) ?? { hour: first + i, sold: 0, entries: 0 },
      )
    : [];
  const max = Math.max(1, ...hours.flatMap((h) => [h.sold, h.entries]));

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
        <h2 className="font-semibold">Activité par heure</h2>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: SOLD_COLOR }}
              aria-hidden
            />{' '}
            Billets vendus
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: ENTRIES_COLOR }}
              aria-hidden
            />{' '}
            Entrées
          </span>
          {hours.length > 0 && (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              className="font-semibold text-forest underline"
            >
              {asTable ? 'Graphique' : 'Tableau'}
            </button>
          )}
        </div>
      </div>
      {hours.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Aucune activité aujourd’hui.</p>
      ) : asTable ? (
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Heure</th>
              <th className="px-4 py-2 text-right font-medium">Billets vendus</th>
              <th className="px-4 py-2 text-right font-medium">Entrées</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {hours.map((h) => (
              <tr key={h.hour}>
                <td className="px-4 py-1.5">{h.hour} h</td>
                <td className="px-4 py-1.5 text-right">{h.sold}</td>
                <td className="px-4 py-1.5 text-right">{h.entries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-4 pb-3 pt-6">
          <div
            className="relative flex h-44 items-end gap-1 border-b border-line"
            role="img"
            aria-label="Billets vendus et entrées par heure"
          >
            <span className="absolute -top-5 left-0 text-xs text-muted">{max}</span>
            {hours.map((h) => (
              <div
                key={h.hour}
                tabIndex={0}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] outline-none"
              >
                <div
                  className="w-full max-w-3 rounded-t-[4px]"
                  style={{ height: `${(h.sold / max) * 100}%`, background: SOLD_COLOR }}
                />
                <div
                  className="w-full max-w-3 rounded-t-[4px]"
                  style={{ height: `${(h.entries / max) * 100}%`, background: ENTRIES_COLOR }}
                />
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg bg-charcoal px-2 py-1 text-xs text-ivory shadow-lift group-hover:block group-focus:block">
                  {h.hour} h · {h.sold} vendu(s) · {h.entries} entrée(s)
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[11px] text-muted">
            {hours.map((h, i) => (
              <span key={h.hour} className="min-w-0 flex-1 text-center">
                {hours.length <= 12 || i % 2 === 0 ? `${h.hour}h` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
