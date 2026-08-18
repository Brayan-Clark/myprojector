import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Check, FileText, HardDrive, Headphones, History, Music, Search, Smartphone, Stethoscope, Sunrise, Save, Keyboard, X } from "lucide-react";
import { DocsSection } from "./DocsSection";
import { MofonainaSection } from "./MofonainaSection";
import { AudioSection } from "./AudioSection";
import { ModulesSection } from "./ModulesSection";
import { StorageSection } from "./StorageSection";
import { DiagnosticSection } from "./DiagnosticSection";
import { HistorySection } from "./HistorySection";
import { BackupSection } from "./BackupSection";
import { RemoteSection } from "./RemoteSection";
import { HelpSection } from "./HelpSection";

type SectionId = "hymnes" | "bible" | "docs" | "mofonaina" | "audio" | "storage" | "diagnostic" | "history" | "backup" | "remote" | "help";

const SECTIONS: { id: SectionId; label: string; hint: string; icon: any }[] = [
  { id: "hymnes", label: "Recueils", hint: "Chants", icon: Music },
  { id: "bible", label: "Bibles", hint: "Versions", icon: BookOpen },
  { id: "docs", label: "Documents", hint: "Livres PDF", icon: FileText },
  { id: "mofonaina", label: "Mofon'aina", hint: "Méditations", icon: Sunrise },
  { id: "audio", label: "Audio", hint: "Playbacks", icon: Headphones },
  { id: "history", label: "Historique", hint: "Chants projetés", icon: History },
  { id: "storage", label: "Stockage", hint: "Espace disque", icon: HardDrive },
  { id: "diagnostic", label: "Diagnostic", hint: "État machine", icon: Stethoscope },
  { id: "backup", label: "Sauvegarde", hint: "Profil", icon: Save },
  { id: "remote", label: "Télécommande", hint: "Depuis le mobile", icon: Smartphone },
  { id: "help", label: "Raccourcis", hint: "Aide", icon: Keyboard },
];

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

  // Confirmation visible : sans elle, cliquer "Ajouter à l'agenda" ne donnait
  // aucun retour et on ne savait pas si l'action avait fonctionné.
  const addWithFeedback = useCallback((item: any) => {
    onAddToPlaylist(item);
    setToast(`« ${item.title} » ajouté à l'agenda`);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, [onAddToPlaylist]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#1a1b1e]">
      {/* En-tête */}
      <header className="flex shrink-0 items-center gap-4 border-b border-white/5 px-6 py-4">
        <div>
          <h1 className="text-lg font-black tracking-tight text-white">Bibliothèque</h1>
          <p className="text-[11px] text-gray-500">Télécharge uniquement ce dont tu as besoin</p>
        </div>

        <div className="relative ml-auto w-full max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="w-full rounded-md border border-white/10 bg-[#232428] py-2 pl-9 pr-3 text-xs text-gray-200 outline-none transition placeholder:text-gray-600 focus:border-[#5865f2]"
          />
        </div>

        <button
          onClick={onClose}
          title="Fermer la bibliothèque"
          className="rounded-full p-2 text-gray-400 transition hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Rail de navigation */}
        <nav className="w-52 shrink-0 space-y-1 overflow-y-auto border-r border-white/5 p-3">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition ${
                  active ? "bg-[#5865f2] text-white" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`}
              >
                <Icon size={16} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold">{s.label}</span>
                  <span className={`block truncate text-[10px] ${active ? "text-white/70" : "text-gray-600"}`}>
                    {s.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Contenu */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {section === "docs" && <DocsSection search={search} onAddToPlaylist={addWithFeedback} />}
          {section === "mofonaina" && <MofonainaSection search={search} onAddToPlaylist={addWithFeedback} />}
          {section === "audio" && <AudioSection search={search} onAddToPlaylist={addWithFeedback} />}
          {section === "history" && <HistorySection search={search} />}
          {section === "storage" && <StorageSection />}
          {section === "diagnostic" && <DiagnosticSection />}
          {section === "backup" && <BackupSection />}
          {section === "remote" && <RemoteSection />}
          {section === "help" && <HelpSection />}
          {(section === "hymnes" || section === "bible") && (
            <ModulesSection category={section} search={search} onLoadDb={onLoadDb} />
          )}
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
