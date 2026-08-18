import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3, Clock, Music, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState, ErrorBox, Spinner } from "./ui";

interface HistoryRow { id: number; ts: number; kind: string; title: string; number: string | null; book: string | null }
interface HistoryTop { title: string; number: string | null; count: number; last_ts: number }

const PERIODS = [
  { days: 30, label: "30 jours" },
  { days: 90, label: "3 mois" },
  { days: 365, label: "1 an" },
];

const fmtDate = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("fr-FR", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });

const fmtTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Ce qui a été projeté, et à quelle fréquence. */
export function HistorySection({ search }: { search: string }) {
  const [recent, setRecent] = useState<HistoryRow[] | null>(null);
  const [top, setTop] = useState<HistoryTop[] | null>(null);
  const [days, setDays] = useState(90);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, t] = await Promise.all([
        invoke<HistoryRow[]>("history_recent", { limit: 200 }),
        invoke<HistoryTop[]>("history_top", { sinceDays: days, limit: 15 }),
      ]);
      setRecent(r);
      setTop(t);
    } catch (e: any) {
      setError(String(e));
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const clear = async () => {
    if (!window.confirm("Effacer tout l'historique des projections ?")) return;
    try {
      await invoke("history_clear");
      await load();
    } catch (e: any) {
      setError(String(e));
    }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!recent || !top) return <Spinner label="Lecture de l'historique" />;

  const q = search.trim().toLowerCase();
  const rows = q ? recent.filter((r) => r.title.toLowerCase().includes(q)) : recent;
  const maxCount = Math.max(1, ...top.map((t) => t.count));

  // Regroupement par jour : c'est ainsi qu'on relit un culte.
  const byDay = rows.reduce<Record<string, HistoryRow[]>>((acc, r) => {
    const key = fmtDate(r.ts);
    (acc[key] ||= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">{recent.length} projections enregistrées</h3>
          <p className="text-[11px] text-gray-500">Ce qui est réellement parti à l'écran</p>
        </div>
        <button onClick={load} title="Actualiser" className="ml-auto rounded-full p-2 text-gray-400 transition hover:bg-white/10 hover:text-white">
          <RefreshCw size={15} />
        </button>
        {recent.length > 0 && (
          <button onClick={clear} title="Tout effacer" className="rounded-full p-2 text-gray-500 transition hover:bg-red-500/15 hover:text-red-400">
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {recent.length === 0 ? (
        <EmptyState>
          Rien pour l'instant. L'historique se remplit dès que tu projettes un chant ou un texte.
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          {/* Les plus projetés */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <BarChart3 size={13} className="text-[#8891f2]" />
              <h4 className="text-xs font-bold text-gray-200">Les plus repris</h4>
              <div className="ml-auto flex gap-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => setDays(p.days)}
                    className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
                      days === p.days ? "bg-[#5865f2] text-white" : "bg-[#202225] text-gray-400 hover:text-white"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-white/5 bg-[#232428]">
              {top.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] text-gray-500">Aucune donnée sur cette période.</p>
              ) : top.map((t) => (
                <div key={t.title} className="border-b border-white/5 px-4 py-2.5 last:border-0">
                  <div className="flex items-baseline gap-2">
                    {t.number && <span className="shrink-0 text-[10px] font-bold tabular-nums text-gray-500">{t.number}</span>}
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-200" title={t.title}>{t.title}</span>
                    <span className="shrink-0 text-[11px] font-bold tabular-nums text-[#8891f2]">{t.count}×</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-[#5865f2]" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                    </div>
                    <span className="shrink-0 text-[9px] text-gray-600">dernier : {fmtDate(t.last_ts)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Journal */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Clock size={13} className="text-[#8891f2]" />
              <h4 className="text-xs font-bold text-gray-200">Journal</h4>
            </div>
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {Object.entries(byDay).map(([day, items]) => (
                <div key={day}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">{day}</p>
                  <div className="overflow-hidden rounded-lg border border-white/5 bg-[#232428]">
                    {items.map((r) => (
                      <div key={r.id} className="flex items-center gap-2.5 border-b border-white/5 px-3 py-2 last:border-0">
                        <Music size={11} className="shrink-0 text-gray-600" />
                        {r.number && <span className="shrink-0 text-[10px] tabular-nums text-gray-500">{r.number}</span>}
                        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-300" title={r.title}>{r.title}</span>
                        <span className="shrink-0 text-[9px] tabular-nums text-gray-600">{fmtTime(r.ts)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {rows.length === 0 && <EmptyState>Aucun résultat pour cette recherche.</EmptyState>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
