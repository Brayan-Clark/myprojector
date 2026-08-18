import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, ChevronDown, ChevronRight, FolderOpen, HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { formatBytes, type LibraryFile } from "../../lib/library";
import { ErrorBox, Spinner } from "./ui";
import { revealInFolder } from "../../lib/openExternal";

interface StorageEntry {
  id: string; label: string; bytes: number; files: number;
  clearable: boolean; path: string; exists: boolean;
}
interface StorageReport {
  entries: StorageEntry[]; total: number;
  partial_files: number; partial_bytes: number; root: string;
}

/**
 * Entretien du stockage : ce que l'application occupe, et ce qui peut être
 * libéré sans rien perdre.
 */
export function StorageSection() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [freed, setFreed] = useState<string | null>(null);
  const [mediaFiles, setMediaFiles] = useState<LibraryFile[] | null>(null);
  const [showMedia, setShowMedia] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReport(await invoke<StorageReport>("storage_report"));
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  const loadMedia = useCallback(async () => {
    try {
      setMediaFiles(await invoke<LibraryFile[]>("list_media_files"));
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (showMedia) loadMedia(); }, [showMedia, loadMedia]);

  /** Supprime un média importé. La confirmation évite tout geste irréversible par erreur. */
  const deleteMedia = async (file: LibraryFile) => {
    // window.confirm() ne fonctionne pas sous WebKitGTK : il renvoie toujours
    // false, donc la suppression n'avait jamais lieu. On passe par le dialogue
    // natif du plugin.
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(
      `Supprimer définitivement « ${file.filename} » (${formatBytes(file.size)}) ?\n\nSi un agenda enregistré l'utilise, il ne s'affichera plus.`,
      { title: "Supprimer un média", kind: "warning" }
    );
    if (!ok) return;
    setBusy(file.path);
    try {
      await invoke("delete_media", { filePath: file.path });
      setFreed(`${file.filename} supprimé · ${formatBytes(file.size)} libérés`);
      await Promise.all([load(), loadMedia()]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const run = async (id: string, command: string, label: string) => {
    setBusy(id);
    setFreed(null);
    try {
      const bytes = await invoke<number>(command);
      setFreed(`${label} : ${formatBytes(bytes)} libérés`);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!report) return <Spinner label="Analyse du stockage" />;

  const max = Math.max(1, ...report.entries.map((e) => e.bytes));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#5865f2]/15 text-[#8891f2]">
          <HardDrive size={18} />
        </span>
        <div>
          <h3 className="text-sm font-bold text-white">{formatBytes(report.total)} utilisés</h3>
          <p className="truncate text-[10px] text-gray-500" title={report.root}>{report.root}</p>
        </div>
        <button
          onClick={async () => {
            const err = await revealInFolder(report.root);
            if (err) setError(err);
          }}
          title="Ouvrir le dossier de l'application"
          className="ml-auto flex items-center gap-1.5 rounded border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-gray-300 transition hover:border-white/25 hover:text-white"
        >
          <FolderOpen size={13} /> Ouvrir le dossier
        </button>
        <button
          onClick={load}
          title="Recalculer"
          className="rounded-full p-2 text-gray-400 transition hover:bg-white/10 hover:text-white"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {freed && (
        <p className="rounded border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-[11px] font-semibold text-emerald-400">
          {freed}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-white/5 bg-[#232428]">
        {report.entries.map((e) => (
          <div key={e.id} className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-xs font-semibold text-gray-200">{e.label}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                  {formatBytes(e.bytes)} · {e.files} fichier{e.files > 1 ? "s" : ""}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full ${e.clearable ? "bg-amber-500" : "bg-[#5865f2]"}`}
                  style={{ width: `${Math.max(2, (e.bytes / max) * 100)}%` }}
                />
              </div>
            </div>

            {e.exists && (
              <button
                onClick={async () => {
                  const err = await revealInFolder(e.path);
                  if (err) setError(err);
                }}
                title={`Ouvrir le dossier : ${e.path}`}
                className="shrink-0 rounded p-1.5 text-gray-500 transition hover:bg-white/10 hover:text-white"
              >
                <FolderOpen size={14} />
              </button>
            )}

            {e.clearable && e.bytes > 0 && (
              <button
                onClick={() => run(e.id, "clear_audio_cache", "Cache vidé")}
                disabled={busy === e.id}
                className="flex shrink-0 items-center gap-1.5 rounded border border-amber-500/40 px-2.5 py-1.5 text-[10px] font-bold text-amber-400 transition hover:bg-amber-500 hover:text-black disabled:opacity-50"
              >
                {busy === e.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Vider
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Détail des médias importés : le seul dossier qu'on ne peut pas vider
          en bloc sans risque, puisqu'un agenda enregistré peut y renvoyer. */}
      <div className="overflow-hidden rounded-lg border border-white/5 bg-[#232428]">
        <button
          onClick={() => setShowMedia(!showMedia)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-white/[0.03]"
        >
          {showMedia ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
          <span className="text-xs font-semibold text-gray-200">Détail des médias de l'agenda</span>
          <span className="ml-auto text-[10px] text-gray-500">
            {mediaFiles ? `${mediaFiles.length} fichiers` : "afficher"}
          </span>
        </button>

        {showMedia && (
          mediaFiles === null ? (
            <p className="px-4 pb-3 text-[11px] text-gray-500">Lecture du dossier…</p>
          ) : mediaFiles.length === 0 ? (
            <p className="px-4 pb-3 text-[11px] text-gray-500">Aucun média importé.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto border-t border-white/5">
              {mediaFiles.map((f) => (
                <div key={f.path} className="flex items-center gap-3 border-b border-white/5 px-4 py-2 last:border-0">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-gray-300" title={f.filename}>
                    {f.filename}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-gray-500">{formatBytes(f.size)}</span>
                  <button
                    onClick={() => deleteMedia(f)}
                    disabled={busy === f.path}
                    title="Supprimer ce fichier du disque"
                    className="shrink-0 rounded p-1.5 text-gray-500 transition hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40"
                  >
                    {busy === f.path ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500">
        Le <span className="text-amber-400">cache des écoutes en ligne</span> se remplit tout seul dès qu'une
        piste est lue sans avoir été téléchargée. Le vider ne supprime aucun contenu installé : les
        pistes concernées seront simplement rechargées à la prochaine écoute.
      </p>

      {report.partial_files > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-3">
          <AlertTriangle size={16} className="shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-300">
              {report.partial_files} téléchargement{report.partial_files > 1 ? "s" : ""} interrompu
              {report.partial_files > 1 ? "s" : ""} · {formatBytes(report.partial_bytes)}
            </p>
            <p className="text-[10px] text-gray-400">
              Restes de transferts coupés en cours de route. Ils n'apparaissent nulle part ailleurs.
            </p>
          </div>
          <button
            onClick={() => run("partials", "clean_partial_downloads", "Nettoyage")}
            disabled={busy === "partials"}
            className="shrink-0 rounded bg-amber-500 px-3 py-1.5 text-[10px] font-bold text-black transition hover:bg-amber-400 disabled:opacity-50"
          >
            {busy === "partials" ? "…" : "Nettoyer"}
          </button>
        </div>
      )}
    </div>
  );
}
