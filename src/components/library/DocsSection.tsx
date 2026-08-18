import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Plus } from "lucide-react";
import {
  docFileName, fetchDocsManifest,
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
  const { installed, progress, failed, download, remove } = useLibraryDownloads("docs");

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
