'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { calendarGoogleOAuthOptions } from '@/lib/auth/oauth-options';
import { deleteCalendarConnection, getCalendarConnection, getCalendarEvents, getCalendars, putCalendarSelection } from '@/lib/calendar/client';
import { createClient } from '@/lib/supabase/client';
import type { CalendarConnectionStatus, ExternalCalendarEvent, GoogleCalendarSummary } from '@/types/calendar';

interface Props { timeMin: string | null; timeMax: string | null; onEvents(events: ExternalCalendarEvent[]): void; }
const errorMessages: Record<string, string> = { oauth_denied: 'Google Calendarの追加権限が許可されませんでした。', missing_code: 'Googleから認証情報が返されませんでした。', missing_refresh_token: 'Refresh Tokenを取得できませんでした。Google Calendarを再接続してください。', exchange_failed: 'Google Calendar接続を完了できませんでした。' };

export function CalendarConnectionPanel({ timeMin, timeMax, onEvents }: Props) {
  const params = useSearchParams();
  const [connection, setConnection] = useState<CalendarConnectionStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(params.get('calendarError') ? errorMessages[params.get('calendarError') as string] ?? 'Google Calendar接続でエラーが発生しました。' : null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const status = await getCalendarConnection(controller.signal);
        setConnection(status);
        setSelectedIds(status.selectedCalendarIds);
        if (!status.connected || status.needsReconnect || !timeMin || !timeMax) { setCalendars([]); onEvents([]); return; }
        const [calendarResult, eventResult] = await Promise.all([getCalendars(controller.signal), getCalendarEvents(timeMin, timeMax, controller.signal)]);
        setCalendars(calendarResult.calendars);
        onEvents(eventResult.events);
        setError(null);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Google Calendarを読み込めませんでした。');
        onEvents([]);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [onEvents, reload, timeMax, timeMin]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const connect = async () => {
    setSaving(true); setError(null);
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: calendarGoogleOAuthOptions(window.location.origin),
    });
    if (oauthError) { setError('Google Calendar接続を開始できませんでした。'); setSaving(false); }
  };
  const save = async () => { setSaving(true); setError(null); try { const result = await putCalendarSelection(selectedIds); setConnection((current) => current ? { ...current, selectedCalendarIds: result.selectedCalendarIds } : current); setReload((value) => value + 1); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Calendar選択を保存できませんでした。'); } finally { setSaving(false); } };
  const disconnect = async () => { if (!window.confirm('Google Calendar接続を解除しますか？Googleログイン状態は維持されます。')) return; setSaving(true); setError(null); try { await deleteCalendarConnection(); setConnection({ connected: false, connectedAt: null, selectedCalendarIds: [], needsReconnect: false }); setCalendars([]); setSelectedIds([]); onEvents([]); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : '接続を解除できませんでした。'); } finally { setSaving(false); } };

  return <section className="rounded-3xl border border-blue-200 bg-white p-4 shadow-sm" aria-label="Google Calendar接続">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Google Calendar</h3><p className="mt-1 text-sm text-slate-600">読み取り専用です。Ginji OSから予定を作成・変更・削除しません。</p></div>{connection?.connected && !connection.needsReconnect ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">接続済み</span> : null}</div>
    {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {loading ? <p role="status" className="mt-3 text-sm text-slate-600">Google Calendarを確認しています…</p> : null}
    {!loading && (!connection?.connected || connection.needsReconnect) ? <div className="mt-4"><p className="text-sm text-slate-600">{connection?.needsReconnect ? '認証が期限切れです。再接続してください。' : '接続操作時だけCalendarの追加権限を確認します。'}</p><button type="button" disabled={saving} onClick={() => void connect()} className="mt-3 min-h-11 rounded-full bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">{connection?.needsReconnect ? 'Google Calendarを再接続' : 'Google Calendarを接続'}</button></div> : null}
    {!loading && connection?.connected && !connection.needsReconnect ? <div className="mt-4 space-y-3">
      <p className="text-xs text-slate-500">最終接続: {connection.connectedAt ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(connection.connectedAt)) : '不明'}</p>
      <fieldset><legend className="text-sm font-semibold">表示するCalendar</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{calendars.map((calendar) => <label key={calendar.calendarId} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={selectedSet.has(calendar.calendarId)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, calendar.calendarId])] : current.filter((id) => id !== calendar.calendarId))} /><span className="min-w-0 truncate">{calendar.summary}{calendar.primary ? '（メイン）' : ''}</span></label>)}</div></fieldset>
      {calendars.length === 0 ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">利用可能なCalendarがありません。</p> : null}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => void save()} className="min-h-11 rounded-full bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">選択を保存・更新</button><button type="button" disabled={saving} onClick={() => void disconnect()} className="min-h-11 rounded-full bg-rose-50 px-4 text-sm font-semibold text-rose-700 disabled:opacity-50">接続解除</button></div>
    </div> : null}
  </section>;
}
