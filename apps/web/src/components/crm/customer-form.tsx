'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { CustomerDetail } from '@/lib/types';

/**
 * Création ou modification d'une fiche client. Toutes les informations sont facultatives (au moins un
 * nom ou un téléphone) ; à la création, le consentement du client est obligatoire.
 */
export function CustomerFormDialog({
  customer,
  initialPhone,
  onClose,
  onSaved,
}: {
  customer?: CustomerDetail;
  initialPhone?: string;
  onClose: () => void;
  onSaved: (customer: CustomerDetail) => void;
}) {
  const [firstName, setFirstName] = useState(customer?.firstName ?? '');
  const [lastName, setLastName] = useState(customer?.lastName ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? initialPhone ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(customer?.marketingConsent ?? false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const body = {
      firstName: firstName.trim() || null,
      lastName: lastName.trim() || null,
      phone: phone.trim() || null,
      ...(customer?.notes !== undefined || !customer ? { notes: notes.trim() || null } : {}),
      marketingConsent: marketing,
    };
    try {
      const saved = customer
        ? await api<CustomerDetail>(`/customers/${customer.id}`, { method: 'PATCH', body })
        : await api<CustomerDetail>('/customers', { method: 'POST', body: { ...body, consent } });
      onSaved(saved);
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={customer ? 'Modifier la fiche client' : 'Nouveau client'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label="Prénom"
            maxLength={60}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <InputField
            label="Nom"
            maxLength={60}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <InputField
          label="Téléphone"
          type="tel"
          maxLength={30}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+223 70 00 00 00"
        />
        {(customer?.notes !== undefined || !customer) && (
          <InputField
            label="Remarque (visible des responsables)"
            maxLength={300}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
        <p className="text-sm text-muted">
          Toutes les informations sont facultatives : un nom ou un téléphone suffit. Ne collectez
          que ce dont le client a besoin (fidélité, réservation).
        </p>
        {!customer && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-forest"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
            />
            <span>
              Le client accepte que ses informations soient conservées pour sa fiche et sa fidélité
              (obligatoire).
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-forest"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
          />
          <span>
            Le client accepte de recevoir des offres (facultatif ; aucun envoi automatique à ce
            stade).
          </span>
        </label>
        {customer && (
          <Alert tone="info">Le consentement a été recueilli à la création de la fiche.</Alert>
        )}
        <Button type="submit" className="w-full" loading={loading}>
          Enregistrer
        </Button>
      </form>
    </Dialog>
  );
}
