// Traitement de l'image (ou vidéo) de fond, et lisibilité du texte posé
// dessus.
//
// Le problème concret : un fond est rarement utilisable tel quel. Une photo de
// coucher de soleil est trop claire pour du texte blanc, une photo sombre
// écrase un texte foncé, et un fond chargé (feuillage, foule) rend n'importe
// quelle couleur de texte illisible. Jusqu'ici la seule issue était de changer
// de fond ; on peut maintenant assombrir, éclaircir ou flouter celui qu'on a.
//
// Les mêmes fonctions servent à la fenêtre de projection ET au mini-moniteur
// de contrôle : l'aperçu reste fidèle, c'est tout l'intérêt.

import type { CSSProperties } from "react";

export type BgFilters = {
  /** % — 100 = inchangé, < 100 assombrit, > 100 éclaircit. */
  brightness: number;
  contrast: number;
  saturate: number;
  /** Rayon du flou en pixels (à l'échelle de l'écran de projection). */
  blur: number;
  /** Opacité du voile uni posé sur le fond, 0 → 100. */
  veil: number;
  veilColor: string;
};

export const DEFAULT_BG_FILTERS: BgFilters = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  blur: 0,
  veil: 0,
  veilColor: "#000000",
};

/** Réglages prêts à l'emploi : l'essentiel du besoin en un clic. */
export const BG_PRESETS: { label: string; hint: string; value: BgFilters }[] = [
  { label: "Normal", hint: "Fond tel quel", value: { ...DEFAULT_BG_FILTERS } },
  {
    label: "Texte clair",
    hint: "Assombri — pour du texte blanc",
    value: { ...DEFAULT_BG_FILTERS, brightness: 62, veil: 25 },
  },
  {
    label: "Texte foncé",
    hint: "Éclairci et délavé — pour du texte noir",
    value: { ...DEFAULT_BG_FILTERS, brightness: 125, saturate: 70, veil: 20, veilColor: "#ffffff" },
  },
  {
    label: "Flou doux",
    hint: "Fond chargé mis en retrait",
    value: { ...DEFAULT_BG_FILTERS, blur: 12, brightness: 80, veil: 15 },
  },
  {
    label: "Cinéma",
    hint: "Très sombre, texte en vedette",
    value: { ...DEFAULT_BG_FILTERS, brightness: 45, contrast: 110, veil: 40 },
  },
];

export function withBgDefaults(filters?: Partial<BgFilters> | null): BgFilters {
  return { ...DEFAULT_BG_FILTERS, ...(filters || {}) };
}

export function isBgFiltersDefault(filters?: Partial<BgFilters> | null): boolean {
  const f = withBgDefaults(filters);
  return (
    f.brightness === 100 && f.contrast === 100 && f.saturate === 100 && f.blur === 0 && f.veil === 0
  );
}

/**
 * Style à poser sur l'image / la vidéo de fond.
 *
 * `blur` est exprimé en `vmin` et non en pixels : le mini-moniteur fait 400 px
 * de large, l'écran de projection 1920. Un flou de 12 px y serait presque
 * invisible d'un côté et énorme de l'autre, et l'aperçu mentirait.
 *
 * L'agrandissement n'est pas un réglage mais une conséquence : flouter une
 * image laisse ses bords transparents (le flou mélange avec le vide), ce qui
 * dessine un cadre délavé. On élargit donc juste assez pour les sortir du
 * cadre.
 */
export function bgMediaStyle(filters?: Partial<BgFilters> | null): CSSProperties {
  const f = withBgDefaults(filters);
  const parts: string[] = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.blur > 0) parts.push(`blur(${(f.blur / 10).toFixed(2)}vmin)`);

  return {
    filter: parts.length ? parts.join(" ") : undefined,
    transform: f.blur > 0 ? `scale(${1 + f.blur / 55})` : undefined,
    // Un fond flouté qui déborde ne doit pas créer de barre de défilement.
    willChange: f.blur > 0 ? "transform" : undefined,
  };
}

/** Style du voile uni, ou `null` s'il n'y a pas de voile à poser. */
export function veilStyle(filters?: Partial<BgFilters> | null): CSSProperties | null {
  const f = withBgDefaults(filters);
  if (f.veil <= 0) return null;
  return { backgroundColor: f.veilColor, opacity: f.veil / 100 };
}

// ---------------------------------------------------------------------------
// Lisibilité du texte
//
// L'ombre portée était codée en dur (`drop-shadow-[0_8px_8px_rgba(0,0,0,1)]`).
// Elle sauve un texte blanc sur fond clair, mais salit un texte foncé sur fond
// clair : c'est bien un réglage, pas une constante.
// ---------------------------------------------------------------------------

export type TextShadow = "none" | "soft" | "strong" | "outline" | "glow";

export const TEXT_SHADOWS: { value: TextShadow; label: string; hint: string }[] = [
  { value: "soft", label: "Ombre douce", hint: "Par défaut, discrète" },
  { value: "strong", label: "Ombre forte", hint: "Fond clair ou chargé" },
  { value: "outline", label: "Contour", hint: "Lisible sur n'importe quoi" },
  { value: "glow", label: "Halo", hint: "Texte foncé sur fond foncé" },
  { value: "none", label: "Aucune", hint: "Fond uni, texte net" },
];

export function textShadowCss(level?: TextShadow, color?: string): string | undefined {
  switch (level) {
    case "none":
      return undefined;
    case "strong":
      return "0 4px 10px rgba(0,0,0,.95), 0 1px 3px rgba(0,0,0,.9)";
    case "outline":
      // Quatre ombres de 2 px dessinent un contour net : `-webkit-text-stroke`
      // amincit le glyphe lui-même et rend les polices fines illisibles.
      return "2px 0 0 rgba(0,0,0,.95), -2px 0 0 rgba(0,0,0,.95), 0 2px 0 rgba(0,0,0,.95), 0 -2px 0 rgba(0,0,0,.95), 0 3px 8px rgba(0,0,0,.7)";
    case "glow":
      // Le halo reprend la couleur du texte : il détache un texte foncé d'un
      // fond foncé, ce qu'aucune ombre noire ne sait faire.
      return `0 0 .25em ${color || "#ffffff"}, 0 0 .6em ${color || "#ffffff"}`;
    case "soft":
    default:
      return "0 3px 8px rgba(0,0,0,.85)";
  }
}
