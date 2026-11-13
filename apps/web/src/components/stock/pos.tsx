'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import type { StockPaymentMethod } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/states';
import { HardwareError, printOnDevice } from '@/lib/hardware/device';
import type { HardwareTarget } from '@/lib/types';

/** Caisse telle que la renvoie l'API (avec sa session ouverte éventuelle). */
export interface StockRegisterView {
  id: string;
  code: string;
  name: string;
  siteId: string;
  locationId: string;
  paperWidth: 58 | 80;
  printerConnection: HardwareTarget['connection'];
  printerAddress: string | null;
  isArchived: boolean;
  site: { id: string; code: string; name: string };
  location: { id: string; code: string; name: string };
  openSession: { id: string; label: string; openedAt: string; openedBy: string | null } | null;
}

export interface StockPosItem {
  variantId: string;
  productId: string;
  label: string;
  sku: string;
  unit: string;
  unitPrice: number;
  vatRate: number;
  isStockable: boolean;
  available: number | null;
}

export interface StockSaleView {
  id: string;
  label: string;
  createdAt: string;
  cashierName: string;
  grossTotal: number;
  discountTotal: number;
  total: number;
  vatTotal: number;
  changeGiven: number;
  reprintCount: number;
  siteId: string;
  register: { id: string; code: string; name: string };
  customer: { id: string; name: string; phone: string | null } | null;
  lines: {
    id: string;
    variantId: string;
    sku: string;
    label: string;
    isStockable: boolean;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    discount: number;
    total: number;
    vatAmount: number;
    returnedQuantity: number;
    refundedAmount: number;
  }[];
  payments: {
    id: string;
    method: StockPaymentMethod;
    amount: number;
    tendered: number | null;
    reference: string | null;
    returnId: string | null;
  }[];
  returns: {
    id: string;
    label: string;
    reason: string;
    restock: boolean;
    refundMethod: StockPaymentMethod;
    refundAmount: number;
    createdAt: string;
    lines: { saleLineId: string; quantity: number; amount: number }[];
  }[];
}

export interface StockReceiptView {
  paperWidth: 58 | 80;
  printer: HardwareTarget;
  preview: string[];
  data: string;
}

export interface StockCustomerView {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  isArchived: boolean;
}

/** Aperçu du ticket : exactement les lignes imprimées, en chasse fixe. */
export function ReceiptPreview({ receipt }: { receipt: StockReceiptView }) {
  return (
    <pre
      className="mx-auto max-w-full overflow-x-auto rounded-xl border border-line bg-white p-3 font-mono text-[11px] leading-snug text-charcoal sm:text-xs"
      style={{ width: `${receipt.paperWidth === 58 ? 34 : 50}ch` }}
      data-testid="stock-receipt-preview"
    >
      {receipt.preview.join('\n')}
    </pre>
  );
}

/**
 * Impression du ticket sur l'imprimante de la caisse (connecteur Android, WebUSB, Bluetooth BLE ou
 * simulation). Un échec d'impression n'annule jamais la vente : le ticket reste disponible en PDF.
 */
export function PrintReceiptButton({
  receipt,
  label = 'Imprimer le ticket',
}: {
  receipt: StockReceiptView;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function print() {
    setBusy(true);
    setMessage(null);
    try {
      if (receipt.printer.connection === 'NONE') {
        throw new HardwareError(
          'PRINTER_NOT_CONFIGURED',
          'Aucune imprimante n’est configurée pour cette caisse : téléchargez le ticket en PDF.',
        );
      }
      await printOnDevice(receipt.printer, receipt.data, receipt.preview);
      setMessage({ tone: 'success', text: 'Ticket envoyé à l’imprimante.' });
    } catch (e) {
      setMessage({
        tone: 'error',
        text: e instanceof HardwareError ? e.message : 'Impression impossible.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        loading={busy}
        icon={<Printer className="h-4 w-4" aria-hidden />}
        onClick={() => void print()}
      >
        {label}
      </Button>
      {message && (
        <Alert tone={message.tone === 'success' ? 'success' : 'error'} title={message.text} />
      )}
    </div>
  );
}
