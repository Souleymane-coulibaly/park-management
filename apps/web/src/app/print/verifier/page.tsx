'use client';

import { useState } from 'react';
import { type ScanFeedback, ScanField } from '@/components/scan/scan-field';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

interface Verify {
  result: 'VALID' | 'REVOKED' | 'UNKNOWN' | 'OTHER_APP';
  card?: { cardNumber: string; revokeReason: string | null };
  holder?: {
    id: string;
    lastName: string;
    firstName: string;
    reference: string | null;
    hasPhoto: boolean;
  } | null;
}

const LABELS = {
  VALID: 'Carte valide',
  REVOKED: 'Carte révoquée',
  UNKNOWN: 'Carte inconnue',
  OTHER_APP: 'Carte gérée par Ocall School : vérifiez-la depuis School',
};

export default function PrintVerifyPage() {
  const [res, setRes] = useState<Verify | null>(null);
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <>
      <PageHeader
        eyebrow="Ocall Print"
        title="Vérifier une carte"
        description="Le QR ne contient aucune donnée personnelle : seule votre organisation peut lire le titulaire."
      />
      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-4">
            <ScanField
              label="Scanner ou coller le QR de la carte"
              feedback={feedback}
              testId="print-verify-input"
              onScan={async (qr) => {
                setError(null);
                try {
                  const r = await api<Verify>('/ocall-print/cards/verify', {
                    method: 'POST',
                    body: { qr },
                  });
                  setRes(r);
                  setFeedback({
                    tone: r.result === 'VALID' ? 'ok' : 'error',
                    message: LABELS[r.result],
                  });
                } catch (e) {
                  setError(
                    e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Erreur réseau.'),
                  );
                }
              }}
            />
            <ApiErrorAlert error={error} />
          </CardBody>
        </Card>
        {res && (
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-start gap-5" data-testid="print-verify-result">
                {res.holder?.hasPhoto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/v1/ocall-print/persons/${res.holder.id}/photo`}
                    alt="Photo du titulaire"
                    className="aspect-[3/4] w-28 rounded-lg border border-line object-cover"
                  />
                )}
                <div className="min-w-0 space-y-1">
                  <p
                    className={`text-lg font-bold ${res.result === 'VALID' ? 'text-forest' : 'text-terracotta-dark'}`}
                  >
                    {LABELS[res.result]}
                  </p>
                  {res.holder && (
                    <p className="font-semibold">
                      {`${res.holder.lastName.toUpperCase()} ${res.holder.firstName}`}
                      {res.holder.reference ? ` — ${res.holder.reference}` : ''}
                    </p>
                  )}
                  {res.card && (
                    <p className="font-mono text-xs text-muted">N° {res.card.cardNumber}</p>
                  )}
                  {res.card?.revokeReason && (
                    <p className="text-sm">Motif : {res.card.revokeReason}</p>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
