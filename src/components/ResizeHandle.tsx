import { useRef, useState } from "react";
import { clamp } from "../lib/panes";

/**
 * Poignée de redimensionnement entre deux panneaux.
 *
 * - Glisser : redimensionne en direct.
 * - Double-clic : revient à la taille d'origine.
 * - Flèches au clavier (quand la poignée a le focus) : ajustement fin.
 *
 * `setPointerCapture` est indispensable : sans lui, passer la souris au-dessus
 * de l'iframe YouTube ou du canvas PDF pendant le glissement coupait le suivi
 * et le panneau restait bloqué à mi-chemin.
 */
export function ResizeHandle({
  orientation,
  value,
  onChange,
  min,
  max,
  invert = false,
  onReset,
  title,
}: {
  orientation: "vertical" | "horizontal";
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  /** Vrai quand le panneau redimensionné est à DROITE (ou EN BAS) de la poignée. */
  invert?: boolean;
  onReset?: () => void;
  title?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const base = useRef(value);

  const isVertical = orientation === "vertical";

  // Un panneau ne peut pas dépasser ce que la fenêtre peut afficher : sans
  // cette borne, agrandir la colonne de gauche écrasait l'éditeur à zéro.
  const hardMax = () =>
    Math.min(max, (isVertical ? window.innerWidth : window.innerHeight) - 200);

  const apply = (coord: number) => {
    const delta = (coord - origin.current) * (invert ? -1 : 1);
    onChange(clamp(base.current + delta, { min, max: hardMax() }));
  };

  return (
    <div
      role="separator"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      tabIndex={0}
      title={title ?? "Glisser pour redimensionner · double-clic pour réinitialiser"}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = isVertical ? e.clientX : e.clientY;
        base.current = value;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        apply(isVertical ? e.clientX : e.clientY);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => onReset?.()}
      onKeyDown={(e) => {
        const less = isVertical ? "ArrowLeft" : "ArrowUp";
        const more = isVertical ? "ArrowRight" : "ArrowDown";
        if (e.key !== less && e.key !== more) return;
        e.preventDefault();
        e.stopPropagation(); // sinon la flèche fait aussi défiler la projection
        const step = (e.shiftKey ? 40 : 12) * (e.key === more ? 1 : -1) * (invert ? -1 : 1);
        onChange(clamp(value + step, { min, max: hardMax() }));
      }}
      className={`group relative z-20 shrink-0 bg-[#18191c] transition-colors ${
        isVertical ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"
      } ${dragging ? "bg-[#5865f2]" : "hover:bg-[#5865f2]/60"}`}
      style={{ touchAction: "none" }}
    >
      {/* Zone d'accroche élargie : une bande de 1 px est juste, mais impossible
          à viser à la souris. Le visuel reste fin, la cible fait 9 px. */}
      <div
        className={`absolute ${
          isVertical ? "-left-1 -right-1 inset-y-0" : "-top-1 -bottom-1 inset-x-0"
        }`}
      />
      {/* Petit repère visuel au survol, pour qu'on devine que c'est glissable. */}
      <div
        className={`pointer-events-none absolute rounded-full bg-white/70 opacity-0 transition-opacity group-hover:opacity-100 ${
          isVertical
            ? "left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2"
            : "left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2"
        } ${dragging ? "opacity-100" : ""}`}
      />
    </div>
  );
}
