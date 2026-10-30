import { useEffect, useState } from "react";
import { Check, Palette, Save, Trash2 } from "lucide-react";
import { cleanUrl } from "../../lib/media";
import { bgMediaStyle, veilStyle } from "../../lib/bgStyle";
import {
  captureTheme, describeTheme, loadThemes, saveThemes, type Theme, type ThemeValue,
} from "../../lib/themes";
import { Popover } from "./ui";

/**
 * Enregistrer / rappeler une apparence complète.
 *
 * ⚠ Pas de `window.prompt()` pour demander le nom : sous WebKitGTK il renvoie
 * `null` sans rien afficher (ARCHITECTURE §5). D'où le champ de saisie intégré
 * au panneau.
 */
export function ThemesMenu({
  open,
  onClose,
  current,
  onApply,
  scopeLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** Réglages de la portée en cours — ce qu'« Enregistrer » capture. */
  current: ThemeValue;
  onApply: (value: ThemeValue) => void;
  scopeLabel?: string;
}) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [name, setName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  // Rechargé à chaque ouverture : la liste vit dans localStorage, et la
  // deuxième fenêtre peut l'avoir modifiée.
  useEffect(() => {
    if (open) {
      setThemes(loadThemes());
      setName("");
      setConfirmId(null);
    }
  }, [open]);

  const persist = (next: Theme[]) => {
    setThemes(next);
    saveThemes(next);
  };

  const handleSave = () => {
    const label = name.trim();
    if (!label) return;
    // Même nom = on remplace, plutôt que d'accumuler des doublons qu'on ne
    // saurait plus distinguer dans la liste.
    const existing = themes.find((t) => t.name.toLowerCase() === label.toLowerCase());
    const theme = captureTheme(label, current, existing?.id ?? `${label}-${themes.length}`);
    persist(existing ? themes.map((t) => (t.id === existing.id ? theme : t)) : [...themes, theme]);
    setName("");
  };

  const handleApply = (t: Theme) => {
    onApply(t.value);
    setApplied(t.id);
    window.setTimeout(() => setApplied(null), 1200);
  };

  return (
    <Popover open={open} onClose={onClose} title="Thèmes d'apparence" width={300}>
      {scopeLabel && (
        <p className="rounded border border-[#5865f2]/30 bg-[#5865f2]/10 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
          Enregistre et applique l'apparence de{" "}
          <span className="font-bold text-[#8891f2]">{scopeLabel}</span> : police, couleurs,
          fond, entête et transition.
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          placeholder="Nom du thème (ex : Noël)"
          className="h-[26px] min-w-0 flex-1 rounded border border-[#36393f] bg-[#1e1f22] px-2 text-[11px] text-gray-100 outline-none focus:border-[#5865f2] placeholder:text-gray-600"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim()}
          title="Enregistrer l'apparence actuelle sous ce nom"
          className="flex h-[26px] shrink-0 items-center gap-1 rounded bg-[#5865f2] px-2.5 text-[11px] font-bold text-white transition hover:bg-[#4752c4] disabled:opacity-40"
        >
          <Save size={12} /> Enregistrer
        </button>
      </div>

      {themes.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          Aucun thème pour l'instant. Réglez une apparence qui vous plaît, donnez-lui un nom,
          et vous la retrouverez ici d'un clic.
        </p>
      ) : (
        <div className="space-y-1">
          {themes.map((t) => (
            <div
              key={t.id}
              className="group flex items-center gap-2 rounded border border-[#36393f] bg-[#1e1f22] p-1.5 transition hover:border-[#5865f2]"
            >
              {/* Vignette : le fond du thème, avec son traitement. Un nom seul
                  ne dit pas à quoi ressemble une apparence. */}
              <div className="relative h-8 w-14 shrink-0 overflow-hidden rounded bg-black">
                {t.value.bgImage && cleanUrl(t.value.bgImage) ? (
                  <img
                    src={cleanUrl(t.value.bgImage)}
                    className="h-full w-full object-cover"
                    style={bgMediaStyle(t.value.bgFilters)}
                    alt=""
                  />
                ) : (
                  <div className="h-full w-full bg-[#2b2d31]" />
                )}
                {veilStyle(t.value.bgFilters) && (
                  <div className="absolute inset-0" style={veilStyle(t.value.bgFilters)!} />
                )}
                <span
                  className="absolute inset-0 flex items-center justify-center text-[8px] font-bold"
                  style={{
                    color: t.value.textSettings?.color || "#fff",
                    fontFamily: t.value.textSettings?.fontFamily,
                    textShadow: "0 1px 3px rgba(0,0,0,.9)",
                  }}
                >
                  Aa
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleApply(t)}
                className="min-w-0 flex-1 text-left"
                title="Appliquer ce thème à la portée en cours"
              >
                <div className="truncate text-[11px] font-bold text-gray-100">{t.name}</div>
                <div className="truncate text-[9px] text-gray-500">{describeTheme(t)}</div>
              </button>

              {applied === t.id ? (
                <Check size={14} className="shrink-0 text-emerald-400" />
              ) : confirmId === t.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => persist(themes.filter((x) => x.id !== t.id))}
                    className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white"
                  >
                    Supprimer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="text-[9px] text-gray-400 hover:text-white"
                  >
                    Non
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmId(t.id)}
                  title="Supprimer ce thème"
                  className="shrink-0 rounded p-1 text-gray-500 opacity-0 transition hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="flex items-start gap-1.5 border-t border-[#1e1f22] pt-2.5 text-[10px] leading-relaxed text-gray-500">
        <Palette size={12} className="mt-0.5 shrink-0" />
        Un thème est une copie : l'appliquer écrit les valeurs dans la portée choisie.
        Le modifier ensuite ne change rien aux diapos déjà réglées.
      </p>
    </Popover>
  );
}
