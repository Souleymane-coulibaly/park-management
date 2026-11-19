'use client';

import { useState } from 'react';
import { SCHOOL_CARD_CHECK_LABELS, type SchoolCardCheckResult } from '@ocall/shared';
import { type ScanFeedback, ScanField } from '@/components/scan/scan-field';
import { SchoolCardsNav } from '@/components/school/school-cards-nav';
import { SchoolPage } from '@/components/school/school-page';
import { Card, CardBody } from '@/components/ui/card';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

interface CheckView {
  result: SchoolCardCheckResult;
  card?: {
    cardNumber: string;
    holderKind: 'STUDENT' | 'STAFF';
    holderId: string;
    validUntil: string | null;
    revokeReason: string | null;
  };
  holder?: {
    lastName: string;
    firstName: string;
    reference: string;
    detail: string | null;
    hasPhoto: boolean;
    active: boolean;
  } | null;
}

const TONE: Record<SchoolCardCheckResult, 'ok' | 'warn' | 'error'> = {
  VALID: 'ok',
  REVOKED: 'error',
  HOLDER_INACTIVE: 'warn',
  UNKNOWN: 'error',
};

/**
 * Lecture d'une carte (QR) par un membre autorisé : seules les cartes des établissements de l'utilisateur
 * sont reconnues ; aucune donnée n'est affichée pour une carte inconnue ou falsifiée.
 */
export default function SchoolCardVerifyPage() {
  const [check, setCheck] = useState<CheckView | null>(null);
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const photo =
    check?.card && check.holder?.hasPhoto
      ? check.card.holderKind === 'STUDENT'
        ? `/api/v1/school/students/${check.card.holderId}/card-photo`
        : `/api/v1/school/staff/${check.card.holderId}/photo`
      : null;
  return (
    <SchoolPage
      title={() => 'Vérifier une carte'}
      description={() =>
        'Lecture du QR d’une carte scolaire ou d’un badge, avec la caméra ou un lecteur.'
      }
      needsSchool={false}
    >
      {() => (
        <div className="space-y-4">
          <SchoolCardsNav />
          <Card>
            <CardBody className="space-y-4">
              <ScanField
                label="Scanner ou coller le QR de la carte"
                feedback={feedback}
                testId="card-verify-input"
                onScan={async (qr) => {
                  setError(null);
                  try {
                    const res = await api<CheckView>('/school/cards/verify', {
                      method: 'POST',
                      body: { qr },
                    });
                    setCheck(res);
                    setFeedback({
                      tone: TONE[res.result],
                      message: SCHOOL_CARD_CHECK_LABELS[res.result],
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
          {check && (
            <Card>
              <CardBody>
                <div className="flex flex-wrap items-start gap-5" data-testid="card-verify-result">
                  {photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo}
                      alt="Photo du titulaire"
                      className="aspect-[3/4] w-28 rounded-lg border border-line object-cover"
                    />
                  )}
                  <div className="min-w-0 space-y-1">
                    <p
                      className={`text-lg font-bold ${check.result === 'VALID' ? 'text-forest' : 'text-terracotta-dark'}`}
                      data-testid="card-verify-status"
                    >
                      {SCHOOL_CARD_CHECK_LABELS[check.result]}
                    </p>
                    {check.holder && (
                      <>
                        <p className="font-semibold">
                          {check.holder.lastName.toUpperCase()} {check.holder.firstName}
                        </p>
                        <p className="text-sm text-muted">
                          {check.card?.holderKind === 'STUDENT' ? 'Élève' : 'Personnel'} —{' '}
                          {check.holder.reference}
                          {check.holder.detail ? ` — ${check.holder.detail}` : ''}
                        </p>
                      </>
                    )}
                    {check.card && (
                      <p className="font-mono text-xs text-muted">N° {check.card.cardNumber}</p>
                    )}
                    {check.card?.revokeReason && (
                      <p className="text-sm">Motif : {check.card.revokeReason}</p>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </SchoolPage>
  );
}
