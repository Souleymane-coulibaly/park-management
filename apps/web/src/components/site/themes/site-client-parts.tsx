'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { ISO_WEEKDAY_LABELS, type SiteHours } from '@ocall/shared';

/**
 * Carte de localisation chargée seulement à la demande : aucun script ni requête tierce tant que
 * le visiteur ne clique pas (économie de données sur mobile, aucun traceur par défaut).
 */
export function MapFacade({
  latitude,
  longitude,
  label,
}: {
  latitude: number;
  longitude: number;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const d = 0.006;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - d}%2C${latitude - d}%2C${longitude + d}%2C${latitude + d}&layer=mapnik&marker=${latitude}%2C${longitude}`;
  if (open) {
    return (
      <iframe
        title={`Carte : ${label}`}
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-72 w-full rounded-2xl border-0 sm:h-80"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-72 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-black/15 bg-white/70 text-center sm:h-80"
    >
      <MapPin className="h-8 w-8" style={{ color: 'var(--brand)' }} aria-hidden />
      <span className="font-semibold">Afficher la carte</span>
      <span className="max-w-xs text-sm opacity-70">
        Carte OpenStreetMap chargée uniquement à votre demande.
      </span>
    </button>
  );
}

/** Horaires de la semaine ; le jour courant (heure de l'appareil) est mis en évidence après chargement. */
export function HoursTable({ hours, note }: { hours: SiteHours[]; note?: string }) {
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => setToday(((new Date().getDay() + 6) % 7) + 1), []);
  return (
    <div>
      <ul className="divide-y divide-black/10 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
        {hours.map((h) => {
          const isToday = h.weekday === today;
          return (
            <li
              key={h.weekday}
              className={`flex items-center justify-between gap-4 px-5 py-3 text-[15px] ${isToday ? 'font-semibold' : ''}`}
              style={
                isToday ? { background: 'color-mix(in srgb, var(--accent) 22%, white)' } : undefined
              }
            >
              <span>
                {ISO_WEEKDAY_LABELS[h.weekday - 1]}
                {isToday && (
                  <span className="ml-2 text-xs uppercase tracking-wide opacity-70">
                    Aujourd’hui
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                {h.closed ? 'Fermé' : `${h.opens} – ${h.closes}`}
              </span>
            </li>
          );
        })}
      </ul>
      {note && <p className="mt-3 text-sm opacity-75">{note}</p>}
    </div>
  );
}
