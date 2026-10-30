'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { type PrinterConnection, isBrowserConnection } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { browserPrintingSupported, pairBrowserPrinter } from '@/lib/hardware/browser-printers';
import { HardwareError } from '@/lib/hardware/hardware-error';

/**
 * Association de l'imprimante USB ou Bluetooth BLE pilotée par le navigateur (PWA) sur CET appareil.
 * Le navigateur exige un geste de l'utilisateur ; WebUSB retrouve ensuite l'imprimante seul.
 * Rien n'est affiché pour les autres types d'imprimante.
 */
export function PairPrinterButton({
  connection,
  address,
}: {
  connection: PrinterConnection;
  address: string | null;
}) {
  const [state, setState] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!isBrowserConnection(connection)) return null;
  if (!browserPrintingSupported(connection)) {
    return (
      <span className="text-sm text-terracotta-dark">
        {connection === 'WEBUSB' ? 'WebUSB' : 'Web Bluetooth'} indisponible dans ce navigateur
        (utilisez Chrome).
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={<Printer className="h-4 w-4" />}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const name = await pairBrowserPrinter(connection, address);
            setState({ tone: 'ok', text: `Imprimante associée : ${name}` });
          } catch (e) {
            setState({
              tone: 'error',
              text: e instanceof HardwareError ? e.message : 'Association impossible.',
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        Associer l’imprimante
      </Button>
      {state && (
        <span
          role="status"
          className={`text-sm ${state.tone === 'ok' ? 'text-forest' : 'text-terracotta-dark'}`}
        >
          {state.text}
        </span>
      )}
    </span>
  );
}
