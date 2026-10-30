'use client';

import { type FormEvent, useState } from 'react';
import { ORDER_CHANNEL_LABELS, STAFF_ORDER_CHANNELS, type StaffOrderChannel } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import type { DiningOverview } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export interface OrderOptions {
  channel: StaffOrderChannel;
  tableId: string | null;
  notes: string;
}

export const DEFAULT_ORDER_OPTIONS: OrderOptions = { channel: 'COUNTER', tableId: null, notes: '' };

/**
 * Canal de la commande (sur place, à emporter, comptoir), table éventuelle et instructions générales.
 * Les tables viennent de la configuration de l'établissement ; un restaurant sans table fonctionne.
 */
export function OrderOptionsBar({
  establishmentId,
  value,
  onChange,
}: {
  establishmentId: string;
  value: OrderOptions;
  onChange: (value: OrderOptions) => void;
}) {
  const dining = useApi<DiningOverview>(`/restaurant/dining?establishmentId=${establishmentId}`);
  const tables = dining.state === 'success' ? dining.data.tables.filter((t) => t.isActive) : [];
  const zoneName = (id: string | null) =>
    dining.state === 'success' ? dining.data.zones.find((z) => z.id === id)?.name : undefined;
  return (
    <div className="space-y-3 border-b border-line/70 px-4 py-3">
      <div role="radiogroup" aria-label="Type de commande" className="grid grid-cols-3 gap-1.5">
        {STAFF_ORDER_CHANNELS.map((channel) => (
          <button
            key={channel}
            type="button"
            role="radio"
            aria-checked={value.channel === channel}
            onClick={() =>
              onChange({ ...value, channel, tableId: channel === 'DINE_IN' ? value.tableId : null })
            }
            className={`min-h-11 rounded-xl px-2 text-sm font-semibold ${value.channel === channel ? 'bg-forest text-white' : 'border border-line bg-surface hover:border-forest'}`}
          >
            {ORDER_CHANNEL_LABELS[channel]}
          </button>
        ))}
      </div>
      {value.channel === 'DINE_IN' && tables.length > 0 && (
        <SelectField
          label="Table"
          value={value.tableId ?? ''}
          onChange={(e) => onChange({ ...value, tableId: e.target.value || null })}
          options={[
            { value: '', label: 'Sans table' },
            ...tables.map((t) => ({
              value: t.id,
              label: [zoneName(t.zoneId), t.name].filter(Boolean).join(' · '),
            })),
          ]}
        />
      )}
      <InputField
        label="Instructions pour la commande"
        value={value.notes}
        maxLength={200}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        placeholder="Allergie, rapidité, couverts…"
      />
    </div>
  );
}

/** Instruction de préparation d'une ligne (« sans oignon », « bien cuit »). */
export function LineNoteDialog({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(initial);
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    onSave(note.trim());
  }
  return (
    <Dialog open onClose={onClose} title={title} description="Instruction pour la cuisine">
      <form onSubmit={onSubmit} className="space-y-4">
        <InputField
          label="Instruction"
          value={note}
          maxLength={200}
          autoFocus
          onChange={(e) => setNote(e.target.value)}
          placeholder="Sans oignon, bien cuit…"
        />
        <Button type="submit" className="w-full">
          Enregistrer l’instruction
        </Button>
      </form>
    </Dialog>
  );
}
