/**
 * usePaymentConfirmed
 *
 * Hoert auf Nostr Kind-3493-Events ("Zahlung bestaetigt", gesendet von der Website).
 *
 * Zwei Typen:
 *   type:"reload" → Chip wurde aufgeladen → App darf valid schreiben
 *   type:"payout" → Chip wurde ausgezahlt → bleibt invalid
 */

import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { KIND_PAYMENT_CONFIRMED, APP_TAG } from '@/lib/chipRegistry';

export interface PaymentConfirmedEvent {
  id: string;
  uid: string;
  type: 'reload' | 'payout' | 'unknown';
  paymentHash: string;
  sats: number;
  timestamp: number;
  pubkey: string;
}

/**
 * Neuestes Kind-3493 Event fuer eine UID, nur NACH `since`.
 */
export function usePaymentConfirmed(uid: string | null, since?: number) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['payment-confirmed', uid],
    enabled: !!uid,
    queryFn: async (c) => {
      const sinceTs = (since ?? Math.floor(Date.now() / 1000)) - 60;
      const events = await nostr.query(
        [{ kinds: [KIND_PAYMENT_CONFIRMED], '#t': [APP_TAG], since: sinceTs, limit: 50 }],
        { signal: c.signal },
      );

      const normalizedUID = (uid ?? '').toUpperCase().replace(/[:\s\-]/g, '');

      const match = events
        .map((e): PaymentConfirmedEvent | null => {
          try {
            const data = JSON.parse(e.content) as Record<string, unknown>;
            const eventUID = String(data.uid ?? '').toUpperCase().replace(/[:\s\-]/g, '');
            if (eventUID !== normalizedUID) return null;
            const t = String(data.type ?? '');
            return {
              id: e.id,
              uid: String(data.uid ?? ''),
              type: t === 'reload' ? 'reload' : t === 'payout' ? 'payout' : 'unknown',
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

/**
 * Neuestes Kind-3493 Event fuer eine UID, OHNE since-Filter.
 * Gibt den aktuellen globalen Status zurueck.
 */
export function useChipPaymentStatus(uid: string | null) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['chip-payment-status', uid],
    enabled: !!uid,
    queryFn: async (c) => {
      const events = await nostr.query(
        [{ kinds: [KIND_PAYMENT_CONFIRMED], '#t': [APP_TAG], limit: 200 }],
        { signal: c.signal },
      );

      const normalizedUID = (uid ?? '').toUpperCase().replace(/[:\s\-]/g, '');

      const match = events
        .map((e): PaymentConfirmedEvent | null => {
          try {
            const data = JSON.parse(e.content) as Record<string, unknown>;
            const eventUID = String(data.uid ?? '').toUpperCase().replace(/[:\s\-]/g, '');
            if (eventUID !== normalizedUID) return null;
            const t = String(data.type ?? '');
            return {
              id: e.id,
              uid: String(data.uid ?? ''),
              type: t === 'reload' ? 'reload' : t === 'payout' ? 'payout' : 'unknown',
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
    refetchInterval: 8_000,
  });
}
