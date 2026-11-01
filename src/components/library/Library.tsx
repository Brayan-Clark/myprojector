import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked, BookOpen, Check, FileText, HardDrive, Headphones, History, Keyboard,
  Library as LibraryIcon, Music, RefreshCw, Save, Search, Smartphone, Stethoscope,
  Sunrise, X,
} from "lucide-react";
import { DocsSection } from "./DocsSection";
import { MofonainaSection } from "./MofonainaSection";
import { SabbathSchoolSection } from "./SabbathSchoolSection";
import { AudioSection } from "./AudioSection";
import { ModulesSection } from "./ModulesSection";
import { StorageSection } from "./StorageSection";
import { DiagnosticSection } from "./DiagnosticSection";
import { HistorySection } from "./HistorySection";
import { BackupSection } from "./BackupSection";
import { RemoteSection } from "./RemoteSection";
import { HelpSection } from "./HelpSection";
import { UpdateSection } from "./UpdateSection";

type SectionId =
  | "hymnes" | "bible" | "docs" | "mofonaina" | "sabbath" | "audio"
  | "storage" | "diagnostic" | "history" | "backup" | "remote" | "update" | "help";

interface Section {
  id: SectionId;
  label: string;
  hint: string;
  icon: any;
  /** Titre et phrase affichés en haut du panneau de contenu. */
  heading: string;
  blurb: string;
  /** La recherche de l'en-tête a-t-elle un sens ici ? */
  searchable?: boolean;
}

/**
 * Les sections, regroupées.
 *
 * Elles étaient présentées comme une liste plate de douze entrées, où
 * « Mofon'aina » voisinait avec « Diagnostic ». Rien n'indiquait qu'on passait
 * des contenus à télécharger aux réglages de la machine, et il fallait relire
 * les douze libellés pour retrouver le bon. Les trois groupes ci-dessous
 * correspondent aux trois raisons d'ouvrir la bibliothèque : chercher du
 * contenu, entretenir le poste, se faire aider.
 */
const GROUPS: { title: string; sections: Section[] }[] = [
  {
    title: "Contenus",
    sections: [
      {
        id: "hymnes", label: "Recueils", hint: "Chants", icon: Music,
        heading: "Recueils de chants",
        blurb: "Installe les recueils dont ton assemblée se sert. Chacun est utilisable hors ligne.",
        searchable: true,
      },
      {
        id: "bible", label: "Bibles", hint: "Versions", icon: BookOpen,
        heading: "Versions bibliques",
        blurb: "Plusieurs versions peuvent cohabiter : la projection en parallèle s'appuie dessus.",
        searchable: true,
      },
      {
        id: "sabbath", label: "École du Sabbat", hint: "Leçons", icon: BookMarked,
        heading: "École du Sabbat",
        blurb: "Leçons du trimestre, dans la langue et la classe de ton choix. Chaque jour s'ajoute à l'agenda comme un texte projetable.",
        searchable: true,
      },
      {
        id: "mofonaina", label: "Mofon'aina", hint: "Méditations", icon: Sunrise,
        heading: "Mofon'aina",
        blurb: "Méditations quotidiennes du livret, avec le verset, la source et le plan de lecture.",
        searchable: true,
      },
      {
        id: "docs", label: "Documents", hint: "Livres PDF", icon: FileText,
        heading: "Documents",
        blurb: "Livres et dossiers par département, projetables page par page.",
        searchable: true,
      },
      {
        id: "audio", label: "Audio", hint: "Playbacks", icon: Headphones,
        heading: "Playbacks audio",
        blurb: "Écoute directe en ligne, ou téléchargement pour ne dépendre de rien pendant le culte.",
        searchable: true,
      },
      {
        id: "history", label: "Historique", hint: "Chants projetés", icon: History,
        heading: "Historique",
        blurb: "Ce qui a déjà été projeté, pour ne pas reprendre le même chant deux semaines de suite.",
        searchable: true,
      },
    ],
  },
  {
    title: "Ce poste",
    sections: [
      {
        id: "storage", label: "Stockage", hint: "Espace disque", icon: HardDrive,
        heading: "Stockage",
        blurb: "Ce que l'application occupe sur le disque, et ce que tu peux libérer sans rien perdre.",
      },
      {
        id: "diagnostic", label: "Diagnostic", hint: "État machine", icon: Stethoscope,
        heading: "Diagnostic",
        blurb: "À lancer sur un poste neuf : la plupart des problèmes de projection viennent de l'environnement.",
      },
      {
        id: "backup", label: "Sauvegarde", hint: "Profil", icon: Save,
        heading: "Sauvegarde",
        blurb: "Exporte tes réglages et tes agendas pour les retrouver sur un autre poste.",
      },
      {
        id: "remote", label: "Télécommande", hint: "Depuis le mobile", icon: Smartphone,
        heading: "Télécommande",
        blurb: "Pilote la projection depuis un téléphone sur le même réseau.",
      },
    ],
  },
  {
    title: "Aide",
    sections: [
      {
        id: "update", label: "Mise à jour", hint: "Version", icon: RefreshCw,
        heading: "Mise à jour",
        blurb: "Rien ne s'installe sans ton accord : on ne redémarre pas une machine en plein culte.",
      },
      {
        id: "help", label: "Raccourcis", hint: "Aide", icon: Keyboard,
        heading: "Raccourcis clavier",
        blurb: "Les gestes qui évitent de chercher la souris pendant la projection.",
      },
    ],
  },
];

const ALL_SECTIONS = GROUPS.flatMap((g) => g.sections);

/**
 * Bibliothèque plein écran. Elle remplace l'ancien panneau logé dans la
 * colonne de 320 px, beaucoup trop étroite pour parcourir 179 documents.
 *
 * Principe : tout est optionnel. L'application marche sans rien télécharger ;
 * l'utilisateur prend uniquement ce qu'il veut, et peut tout retirer.
 */
export function Library({ onClose, onLoadDb, onAddToPlaylist }: {
  onClose: () => void;
  onLoadDb: (category: string, file: string) => void;
  onAddToPlaylist: (item: any) => void;
}) {
  const [section, setSection] = useState<SectionId>("docs");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  const current = useMemo(
    () => ALL_SECTIONS.find((s) => s.id === section) ?? ALL_SECTIONS[0],
    [section]
  );

  // Confirmation visible : sans elle, cliquer "Ajouter à l'agenda" ne donnait
  // aucun retour et on ne savait pas si l'action avait fonctionné.
  const addWithFeedback = useCallback((item: any) => {
    onAddToPlaylist(item);
    setToast(`« ${item.title} » ajouté à l'agenda`);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, [onAddToPlaylist]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // La recherche ne porte que sur la section ouverte : la traîner d'un onglet
  // à l'autre donnait des listes vides sans qu'on comprenne pourquoi.
  useEffect(() => { setSearch(""); }, [section]);

  // Échap ferme, Ctrl+F va à la recherche. Sans ça, fermer la bibliothèque
  // demandait d'aller viser la croix en haut à droite.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && current.searchable) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, current.searchable]);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#1a1b1e]">
      {/* En-tête */}
      <header className="flex shrink-0 items-center gap-4 border-b border-white/5 bg-gradient-to-b from-[#1e1f22] to-[#1a1b1e] px-6 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#5865f2]/15">
          <LibraryIcon size={17} className="text-[#8891f2]" />
        </span>
        <div className="min-w-0">
          <h1 className="text-base font-black tracking-tight text-white">Bibliothèque</h1>
          <p className="text-[11px] text-gray-500">Télécharge uniquement ce dont tu as besoin</p>
        </div>

        {current.searchable && (
          <div className="relative ml-auto w-full max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Rechercher dans ${current.label.toLowerCase()}…`}
              className="w-full rounded-lg border border-white/10 bg-[#232428] py-2 pl-9 pr-16 text-xs text-gray-200 outline-none transition placeholder:text-gray-600 focus:border-[#5865f2] focus:bg-[#26272b]"
            />
            {search ? (
              <button
                onClick={() => setSearch("")}
                title="Effacer"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 transition hover:bg-white/10 hover:text-white"
              >
                <X size={13} />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-gray-600">
                Ctrl F
              </kbd>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          title="Fermer la bibliothèque (Échap)"
          className={`shrink-0 rounded-full p-2 text-gray-400 transition hover:bg-white/10 hover:text-white ${
            current.searchable ? "" : "ml-auto"
          }`}
        >
          <X size={18} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Rail de navigation */}
        <nav className="w-56 shrink-0 overflow-y-auto border-r border-white/5 p-3">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-4 last:mb-0">
              <p className="px-3 pb-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-gray-600">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.sections.map((s) => {
                  const Icon = s.icon;
                  const active = section === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSection(s.id)}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                        active
                          ? "bg-[#5865f2]/15 text-white"
                          : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                      }`}
                    >
                      {/* Le liseré remplace l'ancien aplati bleu : il marque la
                          section ouverte sans écraser son icône. */}
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-[#5865f2]" />
                      )}
                      <Icon size={16} className={`shrink-0 ${active ? "text-[#8891f2]" : ""}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-bold">{s.label}</span>
                        <span className={`block truncate text-[10px] ${active ? "text-gray-400" : "text-gray-600"}`}>
                          {s.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Contenu */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-6 py-5">
            <div className="mb-5 border-b border-white/5 pb-4">
              <h2 className="text-lg font-black tracking-tight text-white">{current.heading}</h2>
              <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-gray-500">{current.blurb}</p>
            </div>

            {section === "docs" && <DocsSection search={search} onAddToPlaylist={addWithFeedback} />}
            {section === "mofonaina" && <MofonainaSection search={search} onAddToPlaylist={addWithFeedback} />}
            {section === "sabbath" && <SabbathSchoolSection search={search} onAddToPlaylist={addWithFeedback} />}
            {section === "audio" && <AudioSection search={search} onAddToPlaylist={addWithFeedback} />}
            {section === "history" && <HistorySection search={search} />}
            {section === "storage" && <StorageSection />}
            {section === "diagnostic" && <DiagnosticSection />}
            {section === "backup" && <BackupSection />}
            {section === "remote" && <RemoteSection />}
            {section === "update" && <UpdateSection />}
            {section === "help" && <HelpSection />}
            {(section === "hymnes" || section === "bible") && (
              <ModulesSection category={section} search={search} onLoadDb={onLoadDb} />
            )}
          </div>
        </main>
      </div>

      {/* Confirmation d'ajout à l'agenda */}
      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[210] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-emerald-500/30 bg-[#232428] px-5 py-3 shadow-2xl shadow-black/50"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
            <Check size={13} className="text-white" strokeWidth={3} />
          </span>
          <span className="text-xs font-semibold text-gray-100">{toast}</span>
        </div>
      )}
    </div>
  );
}
