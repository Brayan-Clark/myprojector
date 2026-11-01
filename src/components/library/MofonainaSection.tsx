import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, CalendarDays, Clock, Plus, Quote, Sunset } from "lucide-react";
import {
  DATA_BASE, fetchMofonainaFiles, fetchMofonainaManifest, meditationToLyrics, readInstalledJson,
  type Meditation, type MofonainaFile, type MofonainaQuarter,
} from "../../lib/library";
import { useLibraryDownloads } from "./useLibrary";
import { Card, EmptyState, ErrorBox, InstallButton, OfflineNotice, Spinner } from "./ui";
import { newItemId } from "../../lib/items";

/** Une fiche de trimestre, qu'elle vienne du manifeste ou du simple nom de fichier. */
interface QuarterCard {
  filename: string;
  label: string;
  /** Présent uniquement quand le manifeste a répondu. */
  meta?: MofonainaQuarter;
}

const frDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** Libellé lisible depuis un nom de fichier : « 2026-Q4.json » → « 2026 · trimestre 4 ». */
const labelOf = (filename: string) =>
  filename.replace(/\.json$/i, "").replace("-", " · trimestre ").replace(/Q/i, "");

/**
 * Les trois extras du livret, affichés sur une seule ligne discrète.
 *
 * Le livret ne les publie pas tous les jours — la lecture du livre paraît le
 * dimanche, le coucher du soleil le vendredi et le sabbat. Chaque élément est
 * donc conditionnel : une ligne vide vaut mieux qu'une ligne de champs vides.
 *
 * ⚠ `psaume_du_jour` ne contient PAS que des psaumes : c'est le plan de lecture
 * biblique de l'année, « Diabe » dans le livret. L'appeler « psaume du jour »
 * serait reprendre à son compte une erreur du nom de champ.
 */
function BookletExtras({ m }: { m: Meditation }) {
  const items = [
    m.psaume_du_jour?.trim() && { icon: BookOpen, label: "Diabe", value: m.psaume_du_jour.trim() },
    m.lecture_du_jour?.trim() && { icon: Quote, label: "Velomin'ny teniny", value: m.lecture_du_jour.trim() },
    m.coucher_du_soleil?.trim() && { icon: Sunset, label: "Coucher du soleil", value: m.coucher_du_soleil.trim() },
  ].filter(Boolean) as { icon: any; label: string; value: string }[];

  if (items.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 pt-2">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <span key={it.label} className="flex items-center gap-1 text-[10px] text-gray-500" title={it.label}>
            <Icon size={10} className="shrink-0 opacity-70" />
            <span className="font-semibold text-gray-400">{it.value}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Mofon'aina : méditations quotidiennes, projetables comme un texte. */
export function MofonainaSection({ search, onAddToPlaylist }: {
  search: string;
  onAddToPlaylist: (item: any) => void;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [manifest, setManifest] = useState<MofonainaQuarter[] | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ filename: string; data: MofonainaFile } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [showAbbr, setShowAbbr] = useState(false);
  const { installed, progress, download, remove } = useLibraryDownloads("mofonaina");

  const load = () => {
    setError(null);
    // Le manifeste est préféré mais pas obligatoire : les trimestres publiés
    // avant son existence ne sont connus que par la liste de fichiers.
    fetchMofonainaManifest()
      .then(({ data }) => setManifest(data.quarters || []))
      .catch(() => setManifest([]));
    fetchMofonainaFiles()
      .then(({ data, stale: fromCache }) => {
        setFiles(data);
        setStale(fromCache ? "Liste servie depuis le cache local." : null);
      })
      .catch((e) => { setFiles([]); setError(String(e)); });
  };
  useEffect(load, []);

  // Un trimestre téléchargé doit rester ouvrable même si le catalogue distant
  // est injoignable : on affiche donc l'union du manifeste, du catalogue et du
  // disque.
  const quarters = useMemo<QuarterCard[]>(() => {
    const byFile = new Map<string, QuarterCard>();
    for (const name of [...(files || []), ...installed]) {
      byFile.set(name, { filename: name, label: labelOf(name) });
    }
    for (const q of manifest || []) {
      if (!q?.file) continue;
      byFile.set(q.file, { filename: q.file, label: q.titre || labelOf(q.file), meta: q });
    }
    return [...byFile.values()].sort((a, b) => b.filename.localeCompare(a.filename));
  }, [files, manifest, installed]);

  const open = async (filename: string) => {
    setOpenError(null);
    setShowAbbr(false);
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

  /**
   * Jour de la semaine : celui du LIVRET quand il est publié, sinon celui
   * calculé par `Intl`. Le livret est l'autorité — c'est lui que l'assemblée a
   * entre les mains — et sa graphie malgache ne dépend d'aucune donnée de
   * locale installée sur la machine.
   */
  const formatDay = (m: Meditation) => {
    const date = new Date(`${m.date}T12:00:00`);
    const booklet = m.jour_semaine?.trim();
    const rest = date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    if (booklet) return `${booklet} ${rest}`;
    return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  };

  if (!files) return <Spinner label="Recherche des trimestres" />;
  // On ne bloque sur l'erreur que s'il n'y a VRAIMENT rien à montrer.
  if (error && quarters.length === 0) return <ErrorBox message={error} onRetry={load} />;
  const offline = error || stale;

  // --- Lecture d'un trimestre installé -------------------------------------
  if (opened) {
    const t = opened.data.trimestre;
    const abbreviations = Object.entries(opened.data.abbreviations || {});
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOpened(null)}
            className="flex items-center gap-1.5 rounded border border-white/10 px-3 py-1.5 text-[11px] font-bold text-gray-300 transition hover:border-white/25 hover:text-white"
          >
            <ArrowLeft size={13} /> Retour
          </button>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-white">{t?.titre_principal}</h3>
            <p className="text-[11px] text-gray-500">
              {t?.annee} · trimestre {t?.numero_trimestre} · {opened.data.meditations.length} méditations
            </p>
          </div>
          {abbreviations.length > 0 && (
            <button
              onClick={() => setShowAbbr(!showAbbr)}
              className={`ml-auto shrink-0 rounded border px-3 py-1.5 text-[11px] font-bold transition ${
                showAbbr
                  ? "border-transparent bg-[#5865f2] text-white"
                  : "border-white/10 text-gray-400 hover:border-white/25 hover:text-gray-200"
              }`}
            >
              Abréviations ({abbreviations.length})
            </button>
          )}
        </div>

        {/* Abréviations du livret : indispensables pour lire les sources
            (« RH », « DHK », « Kôl. »), et jusqu'ici jamais affichées alors
            qu'elles sont publiées avec chaque trimestre. */}
        {showAbbr && (
          <div className="grid gap-x-6 gap-y-1 rounded-lg border border-white/5 bg-[#1e1f22] p-4 sm:grid-cols-2 lg:grid-cols-3">
            {abbreviations.map(([key, value]) => (
              <p key={key} className="flex gap-2 text-[11px] leading-relaxed">
                <span className="shrink-0 font-bold text-[#8891f2]">{key}</span>
                <span className="min-w-0 text-gray-400">{value}</span>
              </p>
            ))}
          </div>
        )}

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
              className={`flex flex-col rounded-lg border p-4 transition ${
                m.date === today
                  ? "border-amber-500/60 bg-amber-500/[0.07] ring-1 ring-amber-500/30"
                  : "border-white/5 bg-[#232428] hover:border-[#5865f2]/50"
              }`}
            >
              <p className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${
                m.date === today ? "text-amber-400" : "text-[#5865f2]"
              }`}>
                <span className="capitalize">{formatDay(m)}</span>
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
              {m.source?.trim() && (
                <p className="mt-1.5 text-[10px] text-gray-600">Source : {m.source.trim()}</p>
              )}
              <BookletExtras m={m} />
              <button
                onClick={() =>
                  onAddToPlaylist({
                    id: newItemId(),
                    title: m.titre_du_jour,
                    number: "📖",
                    lyrics: meditationToLyrics(m),
                    type: "text",
                  })
                }
                className="mt-3 flex items-center gap-1.5 self-start rounded border border-[#5865f2]/40 px-2.5 py-1.5 text-[10px] font-bold text-[#8891f2] transition hover:bg-[#5865f2] hover:text-white"
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
      {offline && (
        <OfflineNotice
          detail={error ? `Catalogue injoignable (${error}) — seuls les trimestres déjà téléchargés sont listés.` : undefined}
          onRetry={load}
        />
      )}
      {quarters.length === 0 ? (
        <EmptyState>Aucun trimestre publié pour le moment.</EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
          {quarters.map(({ filename, label, meta }) => {
            const isInstalled = installed.has(filename);
            const covers = meta && meta.startDate <= today && today <= meta.endDate;
            return (
              <Card
                key={filename}
                accent={covers ? "#f59e0b" : "#a16207"}
                eyebrow={meta ? `${meta.annee} · trimestre ${meta.trimestre}` : "Mofon'aina"}
                title={label}
                badge={covers ? "En cours" : undefined}
                meta={
                  <div className="space-y-1">
                    <span className="flex items-center gap-1.5">
                      <BookOpen size={11} />
                      {meta ? `${meta.count} méditations` : "Méditations quotidiennes"}
                      {meta?.size && <span className="text-gray-600">· {meta.size}</span>}
                    </span>
                    {meta && (
                      <span className="flex items-center gap-1.5">
                        <Clock size={11} /> {frDate(meta.startDate)} → {frDate(meta.endDate)}
                      </span>
                    )}
                  </div>
                }
                onOpen={isInstalled ? () => open(filename) : undefined}
                actions={
                  <div className="flex items-center justify-between gap-2">
                    <InstallButton
                      installed={isInstalled}
                      progress={progress[filename]}
                      onInstall={() => download(filename, meta?.url || `${DATA_BASE}/mofonaina/${filename}`, filename)}
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
