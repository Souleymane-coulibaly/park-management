import { formatXof, sessionLabel, type PublicSiteEvent } from '@ocall/shared';

/**
 * Agenda public d'un parc sur son site vitrine : événements publiés, prochaines séances et tarifs
 * indicatifs. Aucune vente en ligne : les billets se vendent au guichet du parc.
 */
export function SiteEventsAgenda({
  events,
  cardClass,
  titleClass = 'text-xl font-bold',
}: {
  events: PublicSiteEvent[];
  /** Classe de carte du thème (fond, ombre, arrondi). */
  cardClass: string;
  titleClass?: string;
}) {
  if (events.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="site-events">
      <h3 className={titleClass}>Agenda des événements</h3>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {events.map((e) => (
          <li key={e.name} className={`min-w-0 space-y-2 p-5 ${cardClass}`}>
            <p className="text-lg font-bold">{e.name}</p>
            {e.description && (
              <p className="whitespace-pre-line text-[15px] opacity-80">{e.description}</p>
            )}
            <ul className="space-y-1 text-sm">
              {e.sessions.map((s) => (
                <li
                  key={`${s.date}-${s.startTime}`}
                  className="flex flex-wrap justify-between gap-2"
                >
                  <span className="font-semibold">{sessionLabel(s)}</span>
                  {s.soldOut && <span className="font-semibold opacity-75">Complet</span>}
                </li>
              ))}
            </ul>
            {e.tariffs.length > 0 && (
              <p className="text-sm opacity-80">
                {e.tariffs
                  .map(
                    (t) =>
                      `${t.name} : ${formatXof(t.price)}${t.peopleIncluded > 1 ? ` (${t.peopleIncluded} pers.)` : ''}`,
                  )
                  .join(' · ')}
              </p>
            )}
            {e.conditions && <p className="text-sm opacity-65">{e.conditions}</p>}
          </li>
        ))}
      </ul>
      <p className="text-sm opacity-70">
        Tarifs indicatifs. Billets en vente au guichet du parc uniquement.
      </p>
    </div>
  );
}
