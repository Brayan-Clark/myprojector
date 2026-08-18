import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, CalendarDays, Plus } from "lucide-react";
import {
  DATA_BASE, fetchMofonainaFiles, meditationToLyrics, readInstalledJson,
  type MofonainaFile,
} from "../../lib/library";
import { useLibraryDownloads } from "./useLibrary";
import { Card, EmptyState, ErrorBox, InstallButton, Spinner } from "./ui";

/** Mofon'aina : méditations quotidiennes, projetables comme un texte. */
export function MofonainaSection({ search, onAddToPlaylist }: {
  search: string;
  onAddToPlaylist: (item: any) => void;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ filename: string; data: MofonainaFile } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const { installed, progress, download, remove } = useLibraryDownloads("mofonaina");

  const load = () => {
    setError(null);
    fetchMofonainaFiles().then(setFiles).catch((e) => setError(String(e)));
  };
  useEffect(load, []);

  const open = async (filename: string) => {
    setOpenError(null);
    try {
      const raw = await readInstalledJson("mofonaina", filename);
      setOpened({ filename, data: JSON.parse(raw) });
    } catch (e: any) {
      setOpenError(String(e));
    }
  };

  const [month, setMonth] = useState<string>("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const todayRef = useRef<HTMLDivElement>(null);

  // Date locale au format ISO (yyyy-mm-dd), comme les clés du fichier.
  // `toISOString()` est en UTC : à Madagascar (UTC+3) il désigne encore la
  // veille jusqu'à 3 h du matin, ce qui mettrait en avant la mauvaise page.
  const today = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, []);

  const months = useMemo(() => {
    if (!opened) return [];
    const seen = new Map<string, string>();
    for (const m of opened.data.meditations) {
      const key = m.date.slice(0, 7);
      if (!seen.has(key)) {
        const label = new Date(`${key}-01T12:00:00`).toLocaleDateString("fr-FR", {
          month: "long", year: "numeric",
        });
        seen.set(key, label);
      }
    }
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [opened]);

  const hasToday = useMemo(
    () => !!opened?.data.meditations.some((m) => m.date === today),
    [opened, today]
  );

  const meditations = useMemo(() => {
    if (!opened) return [];
    const q = search.trim().toLowerCase();
    return opened.data.meditations
      .filter((m) => {
        if (todayOnly && m.date !== today) return false;
        if (month !== "all" && !m.date.startsWith(month)) return false;
        if (q && !m.titre_du_jour.toLowerCase().includes(q) && !m.date.includes(q)) return false;
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [opened, search, month, todayOnly, today]);

  // Amène la méditation du jour à l'écran à l'ouverture du trimestre.
  useEffect(() => {
    if (opened && todayRef.current) {
      todayRef.current.scrollIntoView({ block: "center" });
    }
  }, [opened]);

  const formatDay = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
      weekday: "long", day: "numeric", month: "long",
    });

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!files) return <Spinner label="Recherche des trimestres" />;

  // --- Lecture d'un trimestre installé -------------------------------------
  if (opened) {
    const t = opened.data.trimestre;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpened(null)}
            className="flex items-center gap-1.5 rounded border border-white/10 px-3 py-1.5 text-[11px] font-bold text-gray-300 transition hover:border-white/25 hover:text-white"
          >
            <ArrowLeft size={13} /> Retour
          </button>
          <div>
            <h3 className="text-sm font-bold text-white">{t?.titre_principal}</h3>
            <p className="text-[11px] text-gray-500">
              {t?.annee} · trimestre {t?.numero_trimestre} · {opened.data.meditations.length} méditations
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-y border-white/5 py-3">
          <button
            onClick={() => { setTodayOnly(false); setMonth("all"); }}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
              !todayOnly && month === "all"
                ? "border-transparent bg-[#5865f2] text-white"
                : "border-white/10 text-gray-400 hover:border-white/25 hover:text-gray-200"
            }`}
          >
            Tout ({opened.data.meditations.length})
          </button>

          {hasToday && (
            <button
              onClick={() => { setTodayOnly(!todayOnly); setMonth("all"); }}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold transition ${
                todayOnly
                  ? "border-transparent bg-amber-500 text-black"
                  : "border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              }`}
            >
              <CalendarDays size={12} /> Aujourd'hui
            </button>
          )}

          {months.map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setMonth(month === key ? "all" : key); setTodayOnly(false); }}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold capitalize transition ${
                month === key
                  ? "border-transparent bg-[#5865f2] text-white"
                  : "border-white/10 text-gray-400 hover:border-white/25 hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          ))}

          <span className="ml-auto text-[11px] text-gray-500">
            {meditations.length} affichée{meditations.length > 1 ? "s" : ""}
          </span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {meditations.map((m) => (
            <div
              key={m.date}
              ref={m.date === today ? todayRef : undefined}
              className={`rounded-lg border p-4 transition ${
                m.date === today
                  ? "border-amber-500/60 bg-amber-500/[0.07] ring-1 ring-amber-500/30"
                  : "border-white/5 bg-[#232428] hover:border-[#5865f2]/50"
              }`}
            >
              <p className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${
                m.date === today ? "text-amber-400" : "text-[#5865f2]"
              }`}>
                <span className="capitalize">{formatDay(m.date)}</span>
                {m.date === today && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-black text-black">
                    AUJOURD'HUI
                  </span>
                )}
              </p>
              <h4 className="mt-1 text-sm font-semibold leading-snug text-gray-100">{m.titre_du_jour}</h4>
              <p className="mt-2 line-clamp-3 text-[11px] italic leading-relaxed text-gray-400">
                {m.verset_texte} <span className="not-italic text-gray-500">({m.verset_reference})</span>
              </p>
              <button
                onClick={() =>
                  onAddToPlaylist({
                    id: `${Date.now()}`,
                    title: m.titre_du_jour,
                    number: "📖",
                    lyrics: meditationToLyrics(m),
                    type: "text",
                  })
                }
                className="mt-3 flex items-center gap-1.5 rounded border border-[#5865f2]/40 px-2.5 py-1.5 text-[10px] font-bold text-[#8891f2] transition hover:bg-[#5865f2] hover:text-white"
              >
                <Plus size={12} /> Ajouter à l'agenda
              </button>
            </div>
          ))}
          {meditations.length === 0 && <EmptyState>Aucune méditation ne correspond.</EmptyState>}
        </div>
      </div>
    );
  }

  // --- Liste des trimestres ------------------------------------------------
  return (
    <div className="space-y-4">
      {openError && <p className="rounded border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">{openError}</p>}
      {files.length === 0 ? (
        <EmptyState>Aucun trimestre publié pour le moment.</EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {files.map((filename) => {
            const isInstalled = installed.has(filename);
            const label = filename.replace(/\.json$/i, "").replace("-", " · trimestre ");
            return (
              <Card
                key={filename}
                accent="#f59e0b"
                eyebrow="Mofon'aina"
                title={label}
                meta={<span className="flex items-center gap-1.5"><BookOpen size={11} /> Méditations quotidiennes</span>}
                onOpen={isInstalled ? () => open(filename) : undefined}
                actions={
                  <div className="flex items-center justify-between gap-2">
                    <InstallButton
                      installed={isInstalled}
                      progress={progress[filename]}
                      onInstall={() => download(filename, `${DATA_BASE}/mofonaina/${filename}`, filename)}
                      onRemove={() => remove(filename)}
                    />
                    {isInstalled && (
                      <button
                        onClick={() => open(filename)}
                        className="rounded border border-[#5865f2]/40 px-2 py-1.5 text-[10px] font-bold text-[#8891f2] transition hover:bg-[#5865f2] hover:text-white"
                      >
                        Ouvrir
                      </button>
                    )}
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
