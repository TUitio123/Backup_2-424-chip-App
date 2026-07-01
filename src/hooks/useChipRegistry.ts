/**
 * useChipRegistry – gibt die fest eingebettete Chip-Liste zurück.
 * Chips werden in src/lib/chipRegistry.ts verwaltet.
 */

import { useQuery } from '@tanstack/react-query';
import { ChipEntry, CHIP_REGISTRY, normalizeUID, lookupChip } from '@/lib/chipRegistry';

export type { ChipEntry };
export { normalizeUID, lookupChip };

export function useChipRegistry() {
  return useQuery<ChipEntry[]>({
    queryKey: ['chip-registry'],
    queryFn: async () => CHIP_REGISTRY,
    staleTime: Infinity,
  });
}
