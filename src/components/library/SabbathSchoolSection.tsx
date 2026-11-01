import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, Check, ChevronDown, Globe, Layers, Plus, Search, X,
} from "lucide-react";
import {
  coversToday, dateRange, fetchIndex, fetchLanguages, fetchLesson, fetchLessons,
  filterLanguages, isoDate, todayIso,
  type SsIndex, type SsLanguage, type SsLesson, type SsLessonContent, type SsQuarterly,
} from "../../lib/sabbathSchool";
import {
  Badge, Card, DetailHeader, EmptyState, ErrorBox, FilterPill, OfflineNotice, SkeletonGrid, Spinner,
} from "./ui";
import { newItemId } from "../../lib/items";

/** Langue retenue d'une session à l'autre : on ne la rechoisit pas chaque semaine. */
const LANG_KEY = "ssLang";

export function SabbathSchoolSection({ search, onAddToPlaylist }: {
  search: string;
  onAddToPlaylist: (item: any) => void;
}) {
  const [languages, setLanguages] = useState<SsLanguage[] | null>(null);
  const [lang, setLang] = useState<string>(() => localStorage.getItem(LANG_KEY) || "mg");

  const [index, setIndex] = useState<SsIndex | null>(null);
  const [indexStale, setIndexStale] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");

  const [quarterly, setQuarterly] = useState<SsQuarterly | null>(null);
  const [lesson, setLesson] = useState<SsLesson | null>(null);

  useEffect(() => { localStorage.setItem(LANG_KEY, lang); }, [lang]);

  useEffect(() => {
    let alive = true;
    fetchLanguages().then(({ data }) => { if (alive) setLanguages(data); });
    return () => { alive = false; };
  }, []);

  const loadIndex = () => {
    setIndex(null);
    setIndexError(null);
    setCategory("all");
    setQuarterly(null);
    setLesson(null);
    fetchIndex(lang)
      .then(({ data, stale }) => { setIndex(data); setIndexStale(stale); })
      .catch((e) => setIndexError(String(e.message || e)));
  };
  useEffect(loadIndex, [lang]);

  const activeLanguage = useMemo(
    () => (languages || []).find((l) => l.code === lang),
    [languages, lang]
  );

  // --- Niveau 3 : les jours d'une leçon ------------------------------------
  if (quarterly && lesson) {
    return (
      <LessonDays
        quarterly={quarterly}
        lesson={lesson}
        onBack={() => setLesson(null)}
        onAddToPlaylist={onAddToPlaylist}
      />
    );
  }

  // --- Niveau 2 : les leçons d'un trimestre --------------------------------
  if (quarterly) {
    return (
      <LessonList
        quarterly={quarterly}
        search={search}
        onBack={() => setQuarterly(null)}
        onOpen={setLesson}
      />
    );
  }

  // --- Niveau 1 : les trimestres -------------------------------------------
  const picker = (
    <LanguagePicker
      languages={languages}
      value={lang}
      active={activeLanguage}
      onChange={setLang}
    />
  );

  if (indexError) {
    return (
      <div className="space-y-4">
        {picker}
        <ErrorBox message={indexError} onRetry={loadIndex} />
      </div>
    );
  }

  if (!index) {
    return (
      <div className="space-y-4">
        {picker}
        <SkeletonGrid count={8} min={200} />
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const visible = index.quarterlies.filter((item) => {
    if (category !== "all" && item.groupTitle !== category) return false;
    if (!q) return true;
    return item.title.toLowerCase().includes(q) || item.groupTitle.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      {picker}

      {indexStale && (
        <OfflineNotice detail="Catalogue servi depuis le cache local — les leçons non consultées ne seront pas lisibles." onRetry={loadIndex} />
      )}

      {/* Les classes viennent de l'API, pas d'une liste figée : elles ne sont
          pas les mêmes d'une langue à l'autre. */}
      {index.categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-y border-white/5 py-3">
          <FilterPill active={category === "all"} onClick={() => setCategory("all")}>
            <Layers size={12} /> Toutes les classes
          </FilterPill>
          {index.categories.map((c) => (
            <FilterPill key={c} active={category === c} onClick={() => setCategory(category === c ? "all" : c)}>
              {c}
            </FilterPill>
          ))}
          <span className="ml-auto text-[11px] text-gray-500">
            {visible.length} trimestre{visible.length > 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {visible.map((item) => {
          const current = coversToday(item.startDate, item.endDate);
          return (
            <Card
              key={item.id}
              accent={item.color || "#f43f5e"}
              cover={item.cover}
              eyebrow={item.groupTitle}
              title={item.title}
              badge={current ? "En cours" : undefined}
              meta={
                <span className="flex items-center gap-1.5">
                  <CalendarDays size={11} /> {dateRange(item.startDate, item.endDate) || item.subtitle || "—"}
                </span>
              }
              onOpen={() => setQuarterly(item)}
              actions={
                <button
                  onClick={() => setQuarterly(item)}
                  className="w-full rounded-md bg-[#5865f2] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#4752c4]"
                >
                  Voir les leçons
                </button>
              }
            />
          );
        })}
        {visible.length === 0 && (
          <EmptyState>
            Aucun trimestre ne correspond. Essaie une autre classe, ou une autre langue.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

/**
 * Choix de la langue.
 *
 * L'amont publie 95 langues. Une liste déroulante brute serait inutilisable :
 * d'où la recherche (sur l'endonyme, le nom anglais et le code) et les trois
 * langues de l'application épinglées en tête.
 */
function LanguagePicker({ languages, value, active, onChange }: {
  languages: SsLanguage[] | null;
  value: string;
  active?: SsLanguage;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Un clic à l'extérieur referme : sans ça, la liste restait ouverte
  // par-dessus la grille des trimestres.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = useMemo(() => filterLanguages(languages || [], query), [languages, query]);

  return (
    <div ref={boxRef} className="relative inline-block">
      <button
        onClick={() => { setOpen(!open); setQuery(""); }}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#232428] px-3 py-2 text-xs font-bold text-gray-200 transition hover:border-white/25"
      >
        {active?.flag ? (
          <span aria-hidden>{active.flag}</span>
        ) : (
          <Globe size={14} className="text-[#8891f2]" />
        )}
        <span>{active?.label || value.toUpperCase()}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase text-gray-500">
          {value}
        </span>
        <ChevronDown size={13} className={`text-gray-500 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-white/10 bg-[#2b2d31] shadow-2xl shadow-black/60">
          <div className="relative border-b border-white/5 p-2">
            <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher une langue…"
              className="w-full rounded-md border border-white/10 bg-[#1e1f22] py-1.5 pl-8 pr-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-[#5865f2]"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {languages === null && <p className="p-3 text-[11px] text-gray-500">Chargement des langues…</p>}
            {list.map((l) => (
              <button
                key={l.code}
                onClick={() => { onChange(l.code); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition ${
                  l.code === value ? "bg-[#5865f2]/20 text-white" : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <span className="w-5 shrink-0 text-center" aria-hidden>{l.flag || "·"}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{l.label}</span>
                {l.label !== l.name && (
                  <span className="min-w-0 max-w-[40%] shrink truncate text-[10px] text-gray-500">{l.name}</span>
                )}
                <span className="shrink-0 font-mono text-[9px] uppercase text-gray-600">{l.code}</span>
                {l.code === value && <Check size={12} className="shrink-0 text-[#8891f2]" />}
              </button>
            ))}
            {languages !== null && list.length === 0 && (
              <p className="p-3 text-[11px] text-gray-500">Aucune langue ne correspond.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Les leçons d'un trimestre, la semaine en cours mise en avant. */
function LessonList({ quarterly, search, onBack, onOpen }: {
  quarterly: SsQuarterly;
  search: string;
  onBack: () => void;
  onOpen: (lesson: SsLesson) => void;
}) {
  const [lessons, setLessons] = useState<SsLesson[] | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  const load = () => {
    setError(null);
    setLessons(null);
    fetchLessons(quarterly.index)
      .then(({ data, stale: fromCache }) => { setLessons(data); setStale(fromCache); })
      .catch((e) => setError(String(e.message || e)));
  };
  useEffect(load, [quarterly.index]);

  // La leçon de la semaine amenée à l'écran : dans un trimestre de treize
  // semaines, c'est celle qu'on vient chercher neuf fois sur dix.
  useEffect(() => {
    if (lessons && currentRef.current) currentRef.current.scrollIntoView({ block: "center" });
  }, [lessons]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!lessons) return <Spinner label={`Chargement de ${quarterly.title}`} />;

  const q = search.trim().toLowerCase();
  const visible = q
    ? lessons.filter((l) => l.title.toLowerCase().includes(q) || l.name.includes(q))
    : lessons;

  return (
    <div className="space-y-4">
      <DetailHeader
        onBack={onBack}
        backLabel="Trimestres"
        title={quarterly.title}
        subtitle={`${quarterly.groupTitle} · ${lessons.length} leçons · ${dateRange(quarterly.startDate, quarterly.endDate)}`}
      />

      {stale && <OfflineNotice detail="Liste des leçons servie depuis le cache local." onRetry={load} />}

      <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-[#232428]">
        {visible.map((l) => {
          const current = coversToday(l.startDate, l.endDate);
          return (
            <button
              key={l.id}
              ref={current ? currentRef : undefined}
              onClick={() => onOpen(l)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.04] ${
                current ? "bg-amber-500/[0.07]" : ""
              }`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-black tabular-nums ${
                current ? "bg-amber-500 text-black" : "bg-white/5 text-gray-500"
              }`}>
                {l.name}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-100">{l.title}</span>
                <span className="block truncate text-[10px] text-gray-500">
                  {dateRange(l.startDate, l.endDate)}
                </span>
              </span>
              {current && <Badge accent="#f59e0b">Cette semaine</Badge>}
            </button>
          );
        })}
        {visible.length === 0 && <EmptyState>Aucune leçon ne correspond.</EmptyState>}
      </div>
    </div>
  );
}

/**
 * Les jours d'une leçon, chacun ajoutable à l'agenda.
 *
 * Le contenu est converti en Markdown (voir `blocksToMarkdown`) : l'agenda le
 * découpe sur les barres `---`, donc un paragraphe par écran, et le rendu
 * conserve les citations et les versets à mémoriser en évidence.
 */
function LessonDays({ quarterly, lesson, onBack, onAddToPlaylist }: {
  quarterly: SsQuarterly;
  lesson: SsLesson;
  onBack: () => void;
  onAddToPlaylist: (item: any) => void;
}) {
  const [content, setContent] = useState<SsLessonContent | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setContent(null);
    fetchLesson(lesson.index)
      .then(({ data, stale: fromCache }) => { setContent(data); setStale(fromCache); })
      .catch((e) => setError(String(e.message || e)));
  };
  useEffect(load, [lesson.index]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!content) return <Spinner label={`Chargement de la leçon ${lesson.name}`} />;

  const today = todayIso();

  const addDay = (title: string, markdown: string) =>
    onAddToPlaylist({
      id: newItemId(),
      title,
      number: "📘",
      lyrics: markdown,
      type: "markdown",
    });

  return (
    <div className="space-y-4">
      <DetailHeader
        onBack={onBack}
        backLabel="Leçons"
        title={`${lesson.name} · ${content.title || lesson.title}`}
        subtitle={`${quarterly.title} · ${content.segments.length} jours · ${dateRange(lesson.startDate, lesson.endDate)}`}
      >
        <button
          onClick={() =>
            addDay(
              `${lesson.name} · ${content.title || lesson.title}`,
              content.segments
                .map((s) => (s.title ? `## ${s.title}\n\n${s.markdown}` : s.markdown))
                .join("\n\n---\n\n")
            )
          }
          title="Ajoute la semaine entière en un seul élément d'agenda"
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#5865f2] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#4752c4]"
        >
          <Plus size={13} /> Toute la leçon
        </button>
      </DetailHeader>

      {stale && <OfflineNotice detail="Leçon servie depuis le cache local." onRetry={load} />}

      <div className="space-y-2">
        {content.segments.map((segment) => {
          const iso = isoDate(segment.date);
          const isToday = iso === today;
          const slides = segment.markdown.split(/\n\s*---\s*\n/).filter((s) => s.trim());
          const open = preview === segment.id;
          return (
            <div
              key={segment.id}
              className={`overflow-hidden rounded-xl border transition ${
                isToday ? "border-amber-500/50 bg-amber-500/[0.06]" : "border-white/5 bg-[#232428]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-3 p-3.5">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-black tabular-nums ${
                  isToday ? "bg-amber-500 text-black" : "bg-white/5 text-gray-500"
                }`}>
                  {segment.name}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-gray-100">{segment.title || `Jour ${segment.name}`}</p>
                  <p className="text-[10px] text-gray-500">
                    {iso
                      ? new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
                          weekday: "long", day: "numeric", month: "long",
                        })
                      : "—"}
                    {" · "}{slides.length} diapo{slides.length > 1 ? "s" : ""}
                  </p>
                </div>
                {isToday && <Badge accent="#f59e0b">Aujourd'hui</Badge>}
                <button
                  onClick={() => setPreview(open ? null : segment.id)}
                  className="shrink-0 rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-gray-300 transition hover:border-white/25 hover:text-white"
                >
                  {open ? "Masquer" : "Aperçu"}
                </button>
                <button
                  onClick={() => addDay(`${segment.name} · ${segment.title || lesson.title}`, segment.markdown)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#5865f2]/40 px-2.5 py-1.5 text-[10px] font-bold text-[#8891f2] transition hover:bg-[#5865f2] hover:text-white"
                >
                  <Plus size={12} /> Agenda
                </button>
              </div>

              {/* L'aperçu montre le découpage RÉEL en diapos : c'est la seule
                  façon de vérifier avant le culte qu'un jour ne donne pas
                  trente écrans de texte. */}
              {open && (
                <div className="border-t border-white/5 bg-black/20 p-3.5">
                  <div className="space-y-2">
                    {slides.map((slide, i) => (
                      <div key={i} className="flex gap-2.5">
                        <span className="w-5 shrink-0 text-right text-[10px] font-bold tabular-nums text-gray-600">
                          {i + 1}
                        </span>
                        <p className="min-w-0 whitespace-pre-wrap text-[11px] leading-relaxed text-gray-400">
                          {slide}
                        </p>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setPreview(null)}
                    className="mt-3 flex items-center gap-1 text-[10px] font-bold text-gray-500 transition hover:text-gray-300"
                  >
                    <X size={11} /> Fermer l'aperçu
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
