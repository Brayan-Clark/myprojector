import { fontStack } from "../lib/fonts";
import { headerOffsetPercent, withHeaderDefaults, type HeaderSettings } from "../lib/header";

const POSITION_CLASS: Record<string, string> = {
  "top-left": "top-0 left-0 items-start justify-start text-left",
  "top-center": "top-0 left-0 right-0 items-start justify-center text-center",
  "top-right": "top-0 right-0 items-start justify-end text-right",
  "bottom-left": "bottom-0 left-0 items-end justify-start text-left",
  "bottom-center": "bottom-0 left-0 right-0 items-end justify-center text-center",
  "bottom-right": "bottom-0 right-0 items-end justify-end text-right",
};

/**
 * Entête de projection, rendue à l'identique par la fenêtre de projection et
 * par le mini-moniteur de contrôle.
 *
 * Un seul composant pour les deux, volontairement : l'entête est justement ce
 * qu'on ne pouvait PAS juger avant de projeter, faute d'aperçu. Deux rendus
 * séparés auraient reproduit le problème au premier écart.
 *
 * `boxHeight` est la clef de l'échelle. Sur la projection, les tailles sont en
 * `vh` (la fenêtre EST l'écran). Dans l'aperçu, on connaît la hauteur de la
 * vignette et on calcule les mêmes proportions en pixels : une entête réglée à
 * 3 % occupe 3 % des deux côtés.
 */
export function ProjectionHeader({
  text,
  settings,
  clock,
  ticker,
  boxHeight,
  zIndex = 60,
}: {
  text: string;
  settings?: Partial<HeaderSettings> | null;
  clock?: any;
  ticker?: any;
  /** Hauteur du cadre en pixels — uniquement pour l'aperçu réduit. */
  boxHeight?: number;
  /** Dans l'aperçu, l'entête doit passer SOUS les boutons de survol. */
  zIndex?: number;
}) {
  const h = withHeaderDefaults(settings);
  if (!h.enabled || !text) return null;

  const pct = h.size / 10; // réglage en dixièmes de pourcent
  const offset = headerOffsetPercent(h, clock, ticker);
  const isTop = h.position.startsWith("top");

  /** Une proportion de la hauteur d'écran, dans l'unité qui convient au cadre. */
  const unit = (percent: number) =>
    boxHeight != null ? `${(percent / 100) * boxHeight}px` : `${percent}vh`;

  const hasPill = h.bgOpacity > 0;

  return (
    <div
      className={`pointer-events-none absolute flex ${POSITION_CLASS[h.position] || POSITION_CLASS["top-right"]}`}
      style={{
        zIndex,
        // La marge de bord suit la taille du texte : une entête deux fois plus
        // grande ne doit pas se coller deux fois plus près du bord.
        padding: `${unit(Math.max(1.5, pct * 0.8))} ${unit(Math.max(2, pct))}`,
        [isTop ? "paddingTop" : "paddingBottom"]: unit(Math.max(1.5, pct * 0.8) + offset),
      }}
    >
      <span
        style={{
          fontFamily: fontStack(h.fontFamily),
          fontSize: unit(pct),
          fontWeight: h.isBold ? 700 : 400,
          color: h.color,
          lineHeight: 1.2,
          backgroundColor: hasPill ? hexToRgba(h.bgColor, h.bgOpacity / 100) : undefined,
          padding: hasPill ? `${unit(pct * 0.25)} ${unit(pct * 0.5)}` : undefined,
          borderRadius: hasPill ? unit(pct * 0.3) : undefined,
          // Sans pastille, l'entête se pose directement sur l'image : il lui
          // faut sa propre ombre, sinon elle disparaît sur un fond clair.
          textShadow: hasPill ? undefined : "0 2px 6px rgba(0,0,0,.85)",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
