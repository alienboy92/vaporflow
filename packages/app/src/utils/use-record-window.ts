import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export function useRecordWindow<T>(records: T[]) {
  const viewport = useRef<HTMLDivElement>(null);
  const enabled = records.length > 200;
  const virtual = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: records.length, enabled, getScrollElement: () => viewport.current,
    estimateSize: () => 80, overscan: 8,
  });
  const items = virtual.getVirtualItems();
  const start = items[0]?.index ?? 0;
  const last = items.at(-1);
  return {
    viewport, start, measure: enabled ? virtual.measureElement : undefined,
    viewportStyle: enabled ? { maxHeight: '65vh', overflow: 'auto' } : undefined,
    padding: enabled ? { paddingTop: items[0]?.start ?? 0, paddingBottom: virtual.getTotalSize() - (last?.end ?? 0) } : undefined,
    visible: enabled ? records.slice(start, last ? last.index + 1 : 0) : records,
  };
}
