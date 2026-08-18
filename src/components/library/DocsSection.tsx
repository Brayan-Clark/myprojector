import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DownloadCloud, ExternalLink, FileText, Plus, X } from "lucide-react";
import {
  docFileName, fetchDocsManifest, formatBytes,
  type DocsManifest, type DocItem,
} from "../../lib/library";
import { useLibraryDownloads } from "./useLibrary";
import { fileExtension, isProjectableDocument, openWithSystem } from "../../lib/openExternal";
import { Card, EmptyState, ErrorBox, InstallButton, Spinner } from "./ui";

/** Les 179 PDF du dépôt : téléchargement à la carte, puis projection. */
export function DocsSection({ search, onAddToPlaylist }: {
  search: string;
  onAddToPlaylist: (item: any) => void;
}) {
  const [manifest, setManifest] = useState<DocsManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [department, setDepartment] = useState<string>("all");
  const { installed, progress, failed, download, remove, refresh } = useLibraryDownloads("docs");

  // Téléchargement groupé de la sélection affichée.
  const [batch, setBatch] = useState<{ done: number; total: number; failed: number; bytes: number; current: string } | null>(null);
  const [batchResult, setBatchResult] = useState<string | null>(null);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ done: number; total: number; skipped: number; failed: number; bytes: number; current: string }>(
      "batch_download_progress",
      (e) => setBatch(e.payload)
    ).then((u) => { un = u; });
    return () => { if (un) un(); };
  }, []);

  const load = () => {
    setError(null);
    fetchDocsManifest().then(setManifest).catch((e) => setError(String(e.message || e)));
  };
  useEffect(load, []);

  const colorOf = (catId: string) =>
    manifest?.categories.find((c) => c.id === catId)?.color || "#5865f2";
  const titleOf = (catId: string) =>
    manifest?.categories.find((c) => c.id === catId)?.title || catId;

  const documents = useMemo(() => {
    if (!manifest) return [];
    const q = search.trim().toLowerCase();
    return manifest.documents.filter((d) => {
      if (category !== "all" && d.categoryId !== category) return false;
      if (department !== "all") {
        const tags = d.tags || [];
        const label = manifest.departments.find((x) => x.id === department)?.translations.fr;
        // Le manifeste étiquette les documents par libellé de département (ou "Tous").
        if (!tags.includes("Tous") && !(label && tags.includes(label))) return false;
      }
      if (q && !d.title.toLowerCase().includes(q) && !d.fileName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [manifest, search, category, department]);

  // Ce qui reste à prendre dans la vue courante : le lot suit exactement les
  // filtres affichés, pour ne jamais télécharger plus que ce que tu vois.
  const pending = useMemo(
    () => documents.filter((d) => !installed.has(docFileName(d))),
    [documents, installed]
  );

  const downloadAll = async () => {
    if (pending.length === 0) return;
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    // Pas d'estimation de taille : les tailles du manifeste sont fausses pour
    // une vingtaine de documents (un fichier de 0,8 Mo y est annoncé à 801 Mo).
    // Le volume réel est affiché pendant et après le téléchargement.
    const ok = await confirm(
      `Télécharger les ${pending.length} documents affichés ?\n\n` +
      `Le volume réel s'affiche au fur et à mesure. Tu peux interrompre à tout ` +
      `moment : les fichiers déjà reçus sont conservés.`,
      { title: "Télécharger la sélection", kind: "info" }
    );
    if (!ok) return;

    setBatchResult(null);
    setBatch({ done: 0, total: pending.length, failed: 0, bytes: 0, current: "" });
    try {
      const summary = await invoke<{ downloaded: number; failed: number; bytes: number; cancelled: boolean }>(
        "download_batch",
        {
          kind: "docs",
          collection: null,
          items: pending.map((d) => ({ url: d.url, filename: docFileName(d) })),
        }
      );
      setBatchResult(
        `${summary.cancelled ? "Interrompu — " : ""}${summary.downloaded} document(s) téléchargé(s) · ` +
        `${formatBytes(summary.bytes)}` +
        (summary.failed > 0 ? ` · ${summary.failed} échec(s)` : "")
      );
    } catch (e) {
      setBatchResult(`Échec du lot : ${e}`);
    } finally {
      setBatch(null);
      await refresh();
    }
  };

  const addToAgenda = async (doc: DocItem) => {
    const filename = docFileName(doc);
    // Un document doit être sur le disque pour être projeté : on le télécharge
    // d'abord si besoin, puis on l'ajoute à l'agenda du jour.
    const path = installed.has(filename)
      ? await pathOf(filename)
      : await download(doc.id, doc.url, filename);
    if (!path) return;
    onAddToPlaylist({
      id: `${Date.now()}`,
      title: doc.title,
      number: "📄",
      lyrics: path,
      type: "document",
    });
  };

  /** Ouvre un .pptx/.docx avec le programme installé sur la machine. */
  const openExternally = async (doc: DocItem) => {
    const filename = docFileName(doc);
    const path = installed.has(filename)
      ? await pathOf(filename)
      : await download(doc.id, doc.url, filename);
    if (!path) return;
    const err = await openWithSystem(path);
    if (err) alert(err);
  };

  const pathOf = async (filename: string) => {
    const { listInstalled } = await import("../../lib/library");
    const files = await listInstalled("docs");
    return files.find((f) => f.filename === filename)?.path || null;
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!manifest) return <Spinner label="Chargement des documents" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={category === "all"} onClick={() => setCategory("all")}>
          Toutes ({manifest.documents.length})
        </Chip>
        {manifest.categories.map((c) => (
          <Chip key={c.id} active={category === c.id} color={c.color} onClick={() => setCategory(c.id)}>
            {c.title}
          </Chip>
        ))}
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="ml-auto rounded border border-white/10 bg-[#1e1f22] px-2 py-1.5 text-[11px] text-gray-300 outline-none focus:border-[#5865f2]"
        >
          <option value="all">Tous les départements</option>
          {manifest.departments.map((d) => (
            <option key={d.id} value={d.id}>{d.translations.fr}</option>
          ))}
        </select>
      </div>

      {batch === null && pending.length > 0 && (
        <button
          onClick={downloadAll}
          className="flex items-center gap-2 rounded bg-[#5865f2] px-3 py-2 text-[11px] font-bold text-white transition hover:bg-[#4752c4]"
        >
          <DownloadCloud size={14} />
          Tout télécharger ({pending.length})
        </button>
      )}

      {batch && (
        <div className="rounded-lg border border-[#5865f2]/30 bg-[#5865f2]/[0.07] p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-gray-100">
                Téléchargement {batch.done} / {batch.total}
                <span className="ml-2 font-normal text-gray-400">{formatBytes(batch.bytes)}</span>
                {batch.failed > 0 && <span className="ml-2 text-amber-400">{batch.failed} échec(s)</span>}
              </p>
              <p className="truncate text-[10px] text-gray-500">{batch.current}</p>
            </div>
            <button
              onClick={() => invoke("cancel_batch_download").catch(() => null)}
              className="flex shrink-0 items-center gap-1 rounded border border-white/15 px-2.5 py-1.5 text-[10px] font-bold text-gray-300 transition hover:border-red-500/50 hover:text-red-400"
            >
              <X size={11} /> Arrêter
            </button>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-[#5865f2] transition-[width] duration-200"
                 style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {batchResult && (
        <p className="rounded border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-[11px] font-semibold text-emerald-400">
          {batchResult}
        </p>
      )}

      {documents.length === 0 ? (
        <EmptyState>Aucun document ne correspond à cette recherche.</EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {documents.map((doc) => {
            const filename = docFileName(doc);
            const isInstalled = installed.has(filename);
            // Seuls les PDF s'affichent dans la fenêtre de projection ; les
            // .pptx/.docx s'ouvrent avec le programme de l'utilisateur.
            const projectable = isProjectableDocument(doc.url);
            return (
              <Card
                key={doc.id}
                accent={colorOf(doc.categoryId)}
                eyebrow={titleOf(doc.categoryId)}
                title={doc.title}
                meta={
                  <span className="flex items-center gap-1.5">
                    <FileText size={11} /> {fileExtension(doc.url)} · {doc.size}
                    {!projectable && <span className="text-amber-500">· hors projection</span>}
                    {failed[doc.id] && <span className="text-red-400">· échec</span>}
                  </span>
                }
                actions={
                  <div className="flex items-center justify-between gap-2">
                    <InstallButton
                      installed={isInstalled}
                      progress={progress[doc.id]}
                      onInstall={() => download(doc.id, doc.url, filename)}
                      onRemove={() => remove(filename)}
                    />
                    {isInstalled && (projectable ? (
                      <button
                        onClick={() => addToAgenda(doc)}
                        title="Ajouter à l'agenda du jour"
                        className="flex items-center gap-1 rounded border border-[#5865f2]/40 px-2 py-1.5 text-[10px] font-bold text-[#8891f2] transition hover:bg-[#5865f2] hover:text-white"
                      >
                        <Plus size={12} /> Agenda
                      </button>
                    ) : (
                      <button
                        onClick={() => openExternally(doc)}
                        title="Ouvrir avec le programme installé sur cet ordinateur"
                        className="flex items-center gap-1 rounded border border-amber-500/40 px-2 py-1.5 text-[10px] font-bold text-amber-400 transition hover:bg-amber-500 hover:text-black"
                      >
                        <ExternalLink size={12} /> Ouvrir
                      </button>
                    ))}
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ active, color, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
        active
          ? "border-transparent bg-[#5865f2] text-white"
          : "border-white/10 text-gray-400 hover:border-white/25 hover:text-gray-200"
      }`}
      style={active && color ? { backgroundColor: color } : undefined}
    >
      {children}
    </button>
  );
}
