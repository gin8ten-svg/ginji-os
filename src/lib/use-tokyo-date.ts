'use client';
import { useSyncExternalStore } from 'react';
import { tokyoDateKey } from '@/lib/date-time';
const subscribe = (notify: () => void) => { const timer = window.setInterval(notify, 30_000); return () => window.clearInterval(timer); };
export function clientTokyoDateSnapshot(now = new Date()): string { return tokyoDateKey(now); }
export function useTokyoDateKey(): string | null { return useSyncExternalStore(subscribe, () => clientTokyoDateSnapshot(), () => null); }
