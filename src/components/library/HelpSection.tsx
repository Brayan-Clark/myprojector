import { Camera, FileText, Keyboard } from "lucide-react";

const SHORTCUTS: { keys: string; label: string; highlight?: boolean }[] = [
  { keys: "Alt + 1", label: "Vue Recueils" },
  { keys: "Alt + 2", label: "Vue Bibles" },
  { keys: "Alt + 3", label: "Ouvrir la bibliothèque" },
  { keys: "Alt + S", label: "Rechercher un chant" },
  { keys: "Alt + Entrée", label: "Projeter la sélection" },
  { keys: "Alt + P", label: "Lancer le 1er élément de l'agenda" },
  { keys: "Alt + L", label: "Activer / couper la projection" },
  { keys: "Alt + B", label: "Écran de base (accueil)" },
  { keys: "Alt + H", label: "Masquer le contenu" },
  { keys: "Alt + N", label: "Écran noir", highlight: true },
  { keys: "Alt + W", label: "Écran blanc", highlight: true },
  { keys: "Alt + R", label: "Reprendre (retirer le voile)", highlight: true },
  { keys: "Alt + C", label: "Afficher / masquer l'horloge" },
  { keys: "Alt + M", label: "Afficher / masquer le bandeau" },
  { keys: "↑ / ↓", label: "Diapo précédente / suivante" },
  { keys: "↓ en fin de chant", label: "Retour à l'écran de base" },
  { keys: "Page suiv. / préc.", label: "Diapo suivante / précédente (clicker)" },
  { keys: ".", label: "Écran noir (clicker)", highlight: true },
  { keys: "Échap", label: "Reprendre l'affichage (clicker)", highlight: true },
];

const FORMATS = [
  { label: "Projetables", value: "PDF, TXT, Markdown, images, vidéos, audio" },
  { label: "Ouverts par le système", value: "PPTX, DOCX, DOC, ODP — via le programme installé sur la machine" },
  { label: "Diapos Markdown", value: "séparées par une ligne ---, avec maths $…$ et médias ![](fichier.mp4)" },
];

/** Aide et raccourcis, déplacés hors de la colonne latérale où ils n'avaient pas leur place. */
export function HelpSection() {
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Keyboard size={15} className="text-[#8891f2]" />
          <h3 className="text-sm font-bold text-white">Raccourcis clavier</h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                s.highlight ? "border-amber-500/25 bg-amber-500/[0.06]" : "border-white/5 bg-[#232428]"
              }`}
            >
              <kbd className="shrink-0 rounded bg-black/40 px-2 py-1 font-mono text-[10px] font-bold text-gray-200">
                {s.keys}
              </kbd>
              <span className="min-w-0 flex-1 text-[11px] text-gray-300">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <FileText size={15} className="text-[#8891f2]" />
          <h3 className="text-sm font-bold text-white">Formats de fichiers</h3>
        </div>
        <div className="overflow-hidden rounded-lg border border-white/5 bg-[#232428]">
          {FORMATS.map((f) => (
            <div key={f.label} className="border-b border-white/5 px-4 py-3 last:border-0">
              <p className="text-[11px] font-bold text-gray-200">{f.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">{f.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Camera size={15} className="text-[#8891f2]" />
          <h3 className="text-sm font-bold text-white">Caméra virtuelle (DroidCam)</h3>
        </div>
        <ul className="space-y-1.5 rounded-lg border border-white/5 bg-[#232428] p-4 text-[11px] leading-relaxed text-gray-400">
          <li>Lancez DroidCam <strong className="text-gray-200">avant</strong> d'activer la caméra.</li>
          <li>Cliquez sur <strong className="text-gray-200">Caméra</strong> dans la barre d'outils.</li>
          <li>Si l'appareil n'est pas détecté, utilisez <strong className="text-gray-200">⟳ Rafraîchir</strong>.</li>
        </ul>
      </section>
    </div>
  );
}
