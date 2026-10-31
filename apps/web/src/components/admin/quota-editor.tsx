'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

/**
 * Dérogation de quota d'une organisation (IA ou stockage). Vide = revenir au quota de l'offre.
 * Toute modification est journalisée (avant / après).
 */
export function QuotaEditor({
  organization,
  field,
  label,
  current,
  onClose,
  onSaved,
}: {
  organization: { id: string; name: string } | null;
  field: 'aiMonthlyCalls' | 'storageMb';
  label: string;
  current: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!organization) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/platform/organizations/${organization.id}/quotas`, {
        method: 'PATCH',
        body: { [field]: value.trim() === '' ? null : Number(value) },
      });
      setValue('');
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={organization !== null}
      onClose={onClose}
      title={`Quota : ${organization?.name ?? ''}`}
      description={`${label} actuel : ${current}. Laissez vide pour revenir au quota de l'offre.`}
    >
      <form onSubmit={submit} className="space-y-3">
        <InputField
          label={label}
          type="number"
          min={0}
          max={1_000_000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving}>
            {value.trim() === '' ? 'Revenir au quota de l’offre' : 'Appliquer la dérogation'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
