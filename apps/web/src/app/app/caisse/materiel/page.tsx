'use client';

import { type FormEvent, useEffect, useState } from 'react';
import {
  CheckCircle2,
  MonitorSmartphone,
  Pencil,
  Plus,
  Printer,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import {
  PRINTER_CONNECTIONS,
  PRINTER_CONNECTION_LABELS,
  validatePrinterAddress,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  bridgeAvailable,
  setSimulatedFailure,
  simulatedFailureEnabled,
} from '@/lib/hardware/device';
import { type HardwareOutcome, runPrintJob } from '@/lib/hardware/jobs';
import { rememberDeviceTerminal } from '@/lib/hardware/use-terminal';
import type {
  DrawerEventView,
  PosEstablishment,
  PosTerminal,
  PrintJobView,
  PrinterConnectionType,
} from '@/lib/types';
import { useApi } from '@/lib/use-api';

const ADDRESS_HINTS: Partial<Record<PrinterConnectionType, string>> = {
  NETWORK: 'IPv4 du réseau local et port d’impression, ex. 192.168.1.50:9100',
  BLUETOOTH: 'Adresse MAC de l’imprimante appairée, ex. 00:11:22:33:44:55',
  USB: 'vendorId:productId en hexadécimal, ex. 04B8:0202',
};

/** Configuration du matériel de caisse : postes, imprimantes thermiques et tiroirs-caisses. */
export default function MaterielPage() {
  const canSell = useCan('pos.sell');
  const canManage = useCan('hardware.manage');
  const establishments = useApi<PosEstablishment[]>(canSell ? '/pos/establishments' : null);
  const terminals = useApi<PosTerminal[]>(canSell ? '/pos-terminals' : null);
  const failedPrints = useApi<PrintJobView[]>(canSell ? '/print-jobs?status=FAILED' : null);
  const drawerEvents = useApi<DrawerEventView[]>(canSell ? '/drawer-events' : null);
  const [editing, setEditing] = useState<PosTerminal | 'new' | null>(null);
  const [tests, setTests] = useState<Record<string, HardwareOutcome | 'RUNNING'>>({});
  const [simulateFailure, setSimulateFailureState] = useState(false);
  const [hasBridge, setHasBridge] = useState(false);

  useEffect(() => {
    setSimulateFailureState(simulatedFailureEnabled());
    setHasBridge(bridgeAvailable());
  }, []);

  if (!canSell) return <AccessDenied />;

  async function testPrint(t: PosTerminal) {
    setTests((s) => ({ ...s, [t.id]: 'RUNNING' }));
    const outcome = await runPrintJob({ terminalId: t.id, kind: 'TEST' });
    setTests((s) => ({ ...s, [t.id]: outcome }));
    failedPrints.reload();
  }

  const reloadAll = () => {
    terminals.reload();
    failedPrints.reload();
  };

  return (
    <>
      <PageHeader
        title="Matériel de caisse"
        description="Postes de caisse, imprimantes thermiques ESC/POS (58 ou 80 mm) et tiroirs-caisses."
        action={
          canManage && (
            <Button
              onClick={() => setEditing('new')}
              disabled={establishments.state !== 'success' || establishments.data.length === 0}
              icon={<Plus className="h-4 w-4" />}
            >
              Nouveau poste
            </Button>
          )
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Alert
          tone={hasBridge ? 'success' : 'info'}
          title={hasBridge ? 'Connecteur Android détecté' : 'Connecteur Android non détecté'}
        >
          {hasBridge
            ? 'Cet appareil peut piloter une imprimante USB, Bluetooth ou réseau.'
            : 'Dans un navigateur classique, seules les imprimantes « Simulation » fonctionnent. Les imprimantes réelles nécessitent l’application Ocall Park pour Android.'}
        </Alert>
        <Card>
          <CardBody className="space-y-2 text-sm">
            <p className="font-semibold">Mode simulation (tests sans matériel)</p>
            <p className="text-muted">
              Les imprimantes « Simulation » n’impriment rien : elles servent à vérifier le
              parcours. Ce n’est pas une validation matérielle.
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-terracotta"
                checked={simulateFailure}
                onChange={(e) => {
                  setSimulatedFailure(e.target.checked);
                  setSimulateFailureState(e.target.checked);
                }}
              />
              Simuler une imprimante indisponible sur cet appareil
            </label>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        {terminals.state === 'loading' && <LoadingState />}
        {terminals.state === 'error' && (
          <ErrorState error={terminals.error} onRetry={terminals.reload} />
        )}
        {terminals.state === 'success' && terminals.data.length === 0 && (
          <EmptyState
            icon={<MonitorSmartphone className="h-7 w-7" />}
            title="Aucun poste de caisse"
            description={
              canManage
                ? 'Créez un poste pour chaque tablette de caisse, puis associez-lui son imprimante.'
                : 'Aucun poste n’est configuré pour le moment.'
            }
          />
        )}
        {terminals.state === 'success' && terminals.data.length > 0 && (
          <Table head={['Poste', 'Établissement', 'Imprimante', 'Papier', 'Tiroir', 'Test', '']}>
            {terminals.data.map((t) => {
              const test = tests[t.id];
              return (
                <tr key={t.id} className={t.isActive ? '' : 'opacity-60'}>
                  <Td className="font-semibold">
                    {t.name} {!t.isActive && <Badge>Désactivé</Badge>}
                  </Td>
                  <Td>{t.establishment.name}</Td>
                  <Td>
                    <span className="block">{PRINTER_CONNECTION_LABELS[t.printerConnection]}</span>
                    {t.printerAddress && (
                      <span className="font-mono text-xs text-muted">{t.printerAddress}</span>
                    )}
                  </Td>
                  <Td>{t.paperWidth} mm</Td>
                  <Td>{t.drawerEnabled ? `Broche ${t.drawerPin}` : '—'}</Td>
                  <Td>
                    {canManage && t.printerConnection !== 'NONE' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={test === 'RUNNING'}
                        onClick={() => testPrint(t)}
                        icon={<Printer className="h-4 w-4" />}
                      >
                        Tester
                      </Button>
                    )}
                    {test && test !== 'RUNNING' && (
                      <span
                        className={`mt-1 block text-xs ${test.status === 'SUCCEEDED' ? 'text-forest' : 'text-terracotta-dark'}`}
                        data-testid={`test-result-${t.name}`}
                      >
                        {test.status === 'SUCCEEDED' ? 'Test réussi' : test.message}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Smartphone className="h-4 w-4" />}
                        onClick={() => {
                          rememberDeviceTerminal(t.establishment.id, t.id);
                          setTests((s) => ({ ...s, [`device-${t.id}`]: { status: 'SUCCEEDED' } }));
                        }}
                      >
                        {tests[`device-${t.id}`] ? (
                          <CheckCircle2 className="h-4 w-4 text-forest" aria-label="Associé" />
                        ) : (
                          'Utiliser sur cet appareil'
                        )}
                      </Button>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(t)}
                          icon={<Pencil className="h-4 w-4" />}
                          aria-label={`Modifier ${t.name}`}
                        />
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Échecs d’impression récents"
            description="Une impression ratée n’annule jamais une vente encaissée."
          />
          {failedPrints.state === 'success' && failedPrints.data.length === 0 && (
            <CardBody className="text-sm text-muted">Aucun échec.</CardBody>
          )}
          {failedPrints.state === 'success' && failedPrints.data.length > 0 && (
            <ul className="divide-y divide-line/70 text-sm">
              {failedPrints.data.slice(0, 10).map((j) => (
                <li key={j.id} className="flex gap-3 px-5 py-3">
                  <TriangleAlert className="h-4 w-4 shrink-0 text-terracotta-dark" aria-hidden />
                  <span>
                    <span className="font-medium">{j.terminalName}</span> ·{' '}
                    {formatDateTime(j.createdAt)} · {j.errorCode}
                    {j.errorMessage && <span className="block text-muted">{j.errorMessage}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Ouvertures du tiroir"
            description="Automatiques après paiement en espèces, ou manuelles justifiées."
          />
          {drawerEvents.state === 'success' && drawerEvents.data.length === 0 && (
            <CardBody className="text-sm text-muted">Aucune ouverture.</CardBody>
          )}
          {drawerEvents.state === 'success' && drawerEvents.data.length > 0 && (
            <ul className="divide-y divide-line/70 text-sm">
              {drawerEvents.data.slice(0, 10).map((e) => (
                <li key={e.id} className="px-5 py-3">
                  <span className="font-medium">
                    {e.reason === 'MANUAL' ? 'Manuelle' : 'Paiement espèces'}
                  </span>{' '}
                  · {e.terminalName} · {formatDateTime(e.createdAt)} · {e.requestedByName}
                  {e.status === 'FAILED' && (
                    <span className="ml-1 text-terracotta-dark">échec ({e.errorCode})</span>
                  )}
                  {e.justification && (
                    <span className="block text-muted">« {e.justification} »</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && (
        <TerminalDialog
          terminal={editing === 'new' ? null : editing}
          establishments={establishments.state === 'success' ? establishments.data : []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadAll();
          }}
        />
      )}
    </>
  );
}

function TerminalDialog({
  terminal,
  establishments,
  onClose,
  onSaved,
}: {
  terminal: PosTerminal | null;
  establishments: PosEstablishment[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    establishmentId: terminal?.establishment.id ?? establishments[0]?.id ?? '',
    name: terminal?.name ?? '',
    printerConnection: (terminal?.printerConnection ?? 'NONE') as PrinterConnectionType,
    printerAddress: terminal?.printerAddress ?? '',
    paperWidth: String(terminal?.paperWidth ?? 80),
    autoPrintReceipt: terminal?.autoPrintReceipt ?? true,
    drawerEnabled: terminal?.drawerEnabled ?? false,
    drawerPin: String(terminal?.drawerPin ?? 2),
    isActive: terminal?.isActive ?? true,
  });
  const [error, setError] = useState<ApiError | null>(null);
  // Établissement par défaut dès que la liste est disponible (création uniquement).
  useEffect(() => {
    if (!terminal && !form.establishmentId && establishments[0]) {
      setForm((f) => ({ ...f, establishmentId: establishments[0]!.id }));
    }
  }, [terminal, form.establishmentId, establishments]);
  const [loading, setLoading] = useState(false);
  const needsAddress = !['NONE', 'SIMULATED'].includes(form.printerConnection);
  const addressError =
    needsAddress && form.printerAddress
      ? validatePrinterAddress(form.printerConnection, form.printerAddress)
      : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const body = {
      name: form.name,
      printerConnection: form.printerConnection,
      printerAddress: needsAddress ? form.printerAddress : null,
      paperWidth: Number(form.paperWidth),
      autoPrintReceipt: form.autoPrintReceipt,
      drawerEnabled: form.printerConnection === 'NONE' ? false : form.drawerEnabled,
      drawerPin: Number(form.drawerPin),
    };
    try {
      if (terminal)
        await api(`/pos-terminals/${terminal.id}`, {
          method: 'PATCH',
          body: { ...body, isActive: form.isActive },
        });
      else
        await api('/pos-terminals', {
          method: 'POST',
          body: { ...body, establishmentId: form.establishmentId },
        });
      onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
      );
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={terminal ? 'Modifier le poste' : 'Nouveau poste de caisse'}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        {!terminal && (
          <SelectField
            label="Établissement"
            value={form.establishmentId}
            onChange={(e) => setForm((f) => ({ ...f, establishmentId: e.target.value }))}
            options={establishments.map((e) => ({ value: e.id, label: e.name }))}
            required
          />
        )}
        <InputField
          label="Nom du poste"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Caisse 1"
          required
        />
        <SelectField
          label="Imprimante"
          value={form.printerConnection}
          onChange={(e) =>
            setForm((f) => ({ ...f, printerConnection: e.target.value as PrinterConnectionType }))
          }
          options={PRINTER_CONNECTIONS.map((c) => ({
            value: c,
            label: PRINTER_CONNECTION_LABELS[c],
          }))}
        />
        {needsAddress && (
          <InputField
            label="Adresse de l’imprimante"
            value={form.printerAddress}
            onChange={(e) => setForm((f) => ({ ...f, printerAddress: e.target.value }))}
            hint={ADDRESS_HINTS[form.printerConnection]}
            error={addressError ?? undefined}
            required
          />
        )}
        {form.printerConnection !== 'NONE' && (
          <>
            <SelectField
              label="Largeur du papier"
              value={form.paperWidth}
              onChange={(e) => setForm((f) => ({ ...f, paperWidth: e.target.value }))}
              options={[
                { value: '58', label: '58 mm (32 caractères)' },
                { value: '80', label: '80 mm (48 caractères)' },
              ]}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-forest"
                checked={form.autoPrintReceipt}
                onChange={(e) => setForm((f) => ({ ...f, autoPrintReceipt: e.target.checked }))}
              />
              Imprimer le ticket automatiquement après chaque paiement
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-forest"
                checked={form.drawerEnabled}
                onChange={(e) => setForm((f) => ({ ...f, drawerEnabled: e.target.checked }))}
              />
              Tiroir-caisse relié à l’imprimante
            </label>
            {form.drawerEnabled && (
              <SelectField
                label="Broche du tiroir"
                value={form.drawerPin}
                onChange={(e) => setForm((f) => ({ ...f, drawerPin: e.target.value }))}
                options={[
                  { value: '2', label: 'Broche 2 (la plus courante)' },
                  { value: '5', label: 'Broche 5' },
                ]}
              />
            )}
          </>
        )}
        {terminal && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-forest"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Poste actif
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading} disabled={!!addressError}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
