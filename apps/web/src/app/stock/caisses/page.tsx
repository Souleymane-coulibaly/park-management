'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { PRINTER_CONNECTION_LABELS, formatStockMoney } from '@ocall/shared';
import { LocationPicker } from '@/components/stock/pickers';
import type { StockRegisterView } from '@/components/stock/pos';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import { type StockSiteView, asApiError } from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import type { HardwareTarget } from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface SessionRow {
  id: string;
  label: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  difference: number | null;
  openedBy: string | null;
  register: { id: string; code: string; name: string };
}

const CONNECTIONS = Object.keys(PRINTER_CONNECTION_LABELS) as HardwareTarget['connection'][];

/** Caisses (site, emplacement vendu, imprimante de tickets) et sessions (ouvertes, clôturées, écarts). */
export default function StockRegistersPage() {
  return (
    <StockPage
      title="Caisses et sessions"
      description="Caisses de chaque magasin, imprimantes de tickets, sessions et écarts de caisse."
    >
      {(p) =>
        p.can('stock.registers.manage') ||
        p.can('stock.sales.read') ||
        p.can('stock.cash.session') ? (
          <Registers {...p} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            Les caisses sont réservées aux caissiers et aux responsables.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Registers(p: StockPageProps) {
  const registers = useApi<StockRegisterView[]>('/ocall-stock/registers');
  const sessions = useApi<SessionRow[]>('/ocall-stock/cash-sessions');
  const money = (n: number) => formatStockMoney(n, p.context.currency);
  const manage = p.canWrite('stock.registers.manage');
  return (
    <>
      {registers.state === 'loading' && <LoadingState />}
      {registers.state === 'error' && (
        <ErrorState error={registers.error} onRetry={registers.reload} />
      )}
      {registers.state === 'success' && (
        <Card>
          <CardHeader title="Caisses" />
          {registers.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucune caisse.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-register-list">
              <Table head={['Caisse', 'Magasin', 'Vend depuis', 'Imprimante', 'Session']}>
                {registers.data.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <span className="font-semibold">{r.name}</span>
                      <span className="block font-mono text-xs text-muted">{r.code}</span>
                    </Td>
                    <Td>{r.site.name}</Td>
                    <Td>{r.location.code}</Td>
                    <Td>
                      {PRINTER_CONNECTION_LABELS[r.printerConnection]} · {r.paperWidth} mm
                    </Td>
                    <Td>
                      {r.openSession ? (
                        <Link
                          href={`/stock/caisses/sessions/${r.openSession.id}`}
                          className="font-medium text-forest hover:underline"
                        >
                          {r.openSession.label} ouverte
                        </Link>
                      ) : (
                        <Badge>Fermée</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {manage && <NewRegister onDone={registers.reload} />}
      {sessions.state === 'success' && sessions.data.length > 0 && (
        <Card>
          <CardHeader title="Sessions" />
          <div data-testid="stock-session-list">
            <Table head={['Session', 'Caisse', 'Ouverture', 'Fond', 'Écart']}>
              {sessions.data.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link
                      href={`/stock/caisses/sessions/${s.id}`}
                      className="font-semibold hover:underline"
                    >
                      {s.label}
                    </Link>{' '}
                    {s.status === 'OPEN' && <Badge tone="forest">Ouverte</Badge>}
                  </Td>
                  <Td>{s.register.name}</Td>
                  <Td>
                    {new Date(s.openedAt).toLocaleString('fr-FR')}
                    {s.openedBy ? ` · ${s.openedBy}` : ''}
                  </Td>
                  <Td>{money(s.openingFloat)}</Td>
                  <Td>
                    {s.difference === null ? (
                      '—'
                    ) : s.difference === 0 ? (
                      <Badge tone="forest">Juste</Badge>
                    ) : (
                      <Badge tone="terracotta">
                        {s.difference > 0 ? '+' : ''}
                        {money(s.difference)}
                      </Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}

function NewRegister({ onDone }: { onDone: () => void }) {
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [paperWidth, setPaperWidth] = useState('80');
  const [connection, setConnection] = useState<HardwareTarget['connection']>('NONE');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/ocall-stock/registers', {
        method: 'POST',
        body: {
          code,
          name,
          locationId,
          paperWidth: Number(paperWidth),
          printerConnection: connection,
          printerAddress: address || null,
        },
      });
      setCode('');
      setName('');
      onDone();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Nouvelle caisse"
        description="La marchandise vendue sort de l’emplacement choisi. L’impression réelle est à valider sur votre matériel."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-register-form">
          <ApiErrorAlert error={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Code (ex. CAISSE1)"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <InputField
              label="Nom"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {sites.state === 'success' && (
            <LocationPicker
              sites={sites.data}
              siteId={siteId}
              onSite={setSiteId}
              locationId={locationId}
              onLocation={setLocationId}
              label="Vend depuis"
            />
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Imprimante de tickets"
              value={connection}
              onChange={(e) => setConnection(e.target.value as HardwareTarget['connection'])}
              options={CONNECTIONS.map((c) => ({ value: c, label: PRINTER_CONNECTION_LABELS[c] }))}
            />
            <InputField
              label="Adresse de l’imprimante"
              hint="IP:port (réseau), adresse MAC (Bluetooth) ; vide pour USB ou navigateur."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <SelectField
              label="Largeur du papier"
              value={paperWidth}
              onChange={(e) => setPaperWidth(e.target.value)}
              options={[
                { value: '80', label: '80 mm' },
                { value: '58', label: '58 mm' },
              ]}
            />
          </div>
          <Button type="submit" disabled={!code || !name || !locationId}>
            Créer la caisse
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
