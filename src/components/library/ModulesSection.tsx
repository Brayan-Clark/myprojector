import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { DATA_BASE } from "../../lib/library";
import { Card, EmptyState, ErrorBox, Spinner } from "./ui";

interface ModuleItem {
  id: string; name: string; language: string; file: string; url: string; size: string;
}

/**
 * Recueils de chants et bibles : ce sont des bases SQLite, gérées par les
 * commandes historiques (download_db / list_dbs / delete_db). Seule la
 * présentation change ici.
 */
export function ModulesSection({ category, search, onLoadDb }: {
  category: "hymnes" | "bible";
  search: string;
  onLoadDb: (category: string, file: string) => void;
}) {
  const [items, setItems] = useState<ModuleItem[] | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch(`${DATA_BASE}/${category}/manifest.json?c=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.versions);
      setInstalled(await invoke<string[]>("list_dbs", { category }));
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };
  useEffect(() => { setItems(null); load(); }, [category]);

  const install = async (m: ModuleItem) => {
    setBusy(m.id);
    try {
      await invoke("download_db", { url: m.url, category, filename: m.file });
      await load();
      await onLoadDb(category, m.file);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (m: ModuleItem) => {
    try {
      await invoke("delete_db", { category, filename: m.file });
      await load();
      onLoadDb(category, "");
    } catch (e) { setError(String(e)); }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!items) return <Spinner label="Chargement des modules" />;

  const q = search.trim().toLowerCase();
  const visible = q ? items.filter((m) => m.name.toLowerCase().includes(q)) : items;

  if (visible.length === 0) return <EmptyState>Aucun module ne correspond.</EmptyState>;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
      {visible.map((m) => {
        const isInstalled = installed.includes(m.file);
        return (
          <Card
            key={m.id}
            accent={category === "hymnes" ? "#10b981" : "#3b82f6"}
            eyebrow={m.language}
            title={m.name}
            meta={m.size}
            actions={
              <div className="flex items-center justify-between gap-2">
                {isInstalled ? (
                  <>
                    <span className="rounded bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400 border border-emerald-500/20">
                      Installé
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => install(m)}
                        disabled={busy === m.id}
                        title="Mettre à jour"
                        className="rounded p-1.5 text-gray-500 transition hover:bg-[#5865f2]/20 hover:text-[#8891f2]"
                      >
                        <RefreshCw size={13} className={busy === m.id ? "animate-spin" : ""} />
                      </button>
                      <button
                        onClick={() => uninstall(m)}
                        className="rounded px-2 py-1 text-[10px] font-bold text-gray-500 transition hover:bg-red-500/15 hover:text-red-400"
                      >
                        Retirer
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => install(m)}
                    disabled={busy === m.id}
                    className="flex items-center gap-1.5 rounded bg-[#5865f2] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#4752c4] disabled:opacity-60"
                  >
                    {busy === m.id ? <RefreshCw size={13} className="animate-spin" /> : null}
                    {busy === m.id ? "Installation…" : "Télécharger"}
                  </button>
                )}
              </div>
            }
          />
        );
      })}
    </div>
  );
}
