/**
 * usePaymentConfirmed
 *
 * Hoert auf Nostr Kind-3493-Events ("Zahlung bestaetigt", gesendet von der Website
 * nachdem eine LN-Invoice bezahlt wurde).
 *
 * Gibt den neuesten bestaetigten Payment-Event fuer eine UID zurueck.
 * KEIN Zeitlimit — die App gleicht IMMER mit der Website ab.
 * Wenn ein Kind-3493 existiert, darf die App den Chip auf "valid" setzen.
 */

import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { KIND_PAYMENT_CONFIRMED, APP_TAG } from '@/lib/chipRegistry';

export interface PaymentConfirmedEvent {
  id: string;
  uid: string;
  paymentHash: string;
  sats: number;
  timestamp: number;
  pubkey: string;
}

export function usePaymentConfirmed(uid: string | null) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['payment-confirmed', uid],
    enabled: !!uid,
    queryFn: async (c) => {
      const events = await nostr.query(
        [{ kinds: [KIND_PAYMENT_CONFIRMED], '#t': [APP_TAG], limit: 50 }],
        { signal: c.signal },
      );

      const normalizedUID = (uid ?? '').toUpperCase().replace(/[:\s\-]/g, '');

      const match = events
        .map((e): PaymentConfirmedEvent | null => {
          try {
            const data = JSON.parse(e.content) as Record<string, unknown>;
            const eventUID = String(data.uid ?? '').toUpperCase().replace(/[:\s\-]/g, '');
            if (eventUID !== normalizedUID) return null;
            return {
              id: e.id,
              uid: String(data.uid ?? ''),
              paymentHash: String(data.paymentHash ?? ''),
              sats: Number(data.sats ?? 0),
              timestamp: e.created_at,
              pubkey: e.pubkey,
            };
          } catch { return null; }
        })
        .filter((e): e is PaymentConfirmedEvent => e !== null)
        .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;

      return match;
    },
    refetchInterval: 5_000,
  });
}
