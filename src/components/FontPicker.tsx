import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { FONTS, FONT_GROUPS, fontStack, type FontEntry } from "../lib/fonts";
import { useFlipAlign } from "../lib/popover";

/**
 * Sélecteur de police avec aperçu.
 *
 * Pourquoi pas un `<select>` : WebKitGTK ignore `font-family` sur les
 * `<option>`. On ne voyait donc qu'une liste de noms, et il fallait valider
 * puis regarder la projection pour savoir à quoi ressemblait la police — avec
 * trente-deux familles ce n'est plus tenable.
 */
export function FontPicker({
  value,
  onChange,
  /** Texte de l'aperçu : on y met le début du verset en cours quand on l'a. */
  sample,
  className = "",
  compact = false,
}: {
  value?: string;
  onChange: (name: string) => void;
  sample?: string;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  // Le sélecteur sert aussi DANS des panneaux (bandeau, entête) qui sont déjà
  // près du bord droit : sa liste doit savoir s'ouvrir de l'autre côté.
  const [panelRef, panelAlign] = useFlipAlign(open);

  // Fermeture au clic extérieur et à Échap : sans ça le panneau restait ouvert
  // par-dessus l'aperçu de projection.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const preview = useMemo(() => {
    const clean = (sample || "").replace(/<\/?[^>]+(>|$)/g, "").trim();
    // Un extrait du contenu réel vaut mieux qu'un pangramme : on juge la
    // police sur le texte qu'on va vraiment projeter.
    return clean ? clean.slice(0, 28) : "Ny fitiavan'Andriamanitra";
  }, [sample]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f: FontEntry) => !q || f.name.toLowerCase().includes(q);
    return FONT_GROUPS.map((group) => ({
      group,
      items: FONTS.filter((f) => f.group === group && match(f)),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((v) => !v);
        }}
        title={`Police : ${value || "Inter"}`}
        className={`flex w-full items-center justify-between gap-2 rounded border border-[#36393f] bg-[#1e1f22] text-gray-100 transition hover:border-[#5865f2] ${
          compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
        }`}
      >
        <span className="truncate" style={{ fontFamily: fontStack(value) }}>
          {value || "Inter"}
        </span>
        <ChevronDown size={12} className="shrink-0 text-gray-500" />
      </button>

      {open && (
        <div
          ref={panelRef}
          className={`absolute top-full z-[200] mt-1 w-72 overflow-hidden rounded-lg border border-[#1e1f22] bg-[#2b2d31] shadow-2xl ${
            panelAlign === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-[#1e1f22] px-2 py-2">
            <Search size={12} className="shrink-0 text-gray-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer les polices…"
              className="w-full bg-transparent text-xs text-gray-100 outline-none placeholder:text-gray-600"
            />
          </div>

          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            {groups.map(({ group, items }) => (
              <div key={group}>
                <div className="sticky top-0 bg-[#232428] px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
                  {group}
                </div>
                {items.map((f) => {
                  const active = f.name === value;
                  return (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => {
                        onChange(f.name);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition ${
                        active ? "bg-[#5865f2]/20" : "hover:bg-[#36393f]"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-[10px] font-bold text-gray-400">
                            {f.name}
                          </span>
                          {f.hint && (
                            <span className="truncate text-[9px] text-gray-600">{f.hint}</span>
                          )}
                        </div>
                        <div
                          className="truncate text-base leading-tight text-gray-100"
                          style={{ fontFamily: fontStack(f.name) }}
                        >
                          {preview}
                        </div>
                      </div>
                      {active && <Check size={13} className="shrink-0 text-[#5865f2]" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="px-3 py-6 text-center text-[11px] text-gray-500">
                Aucune police ne correspond à « {query} ».
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
