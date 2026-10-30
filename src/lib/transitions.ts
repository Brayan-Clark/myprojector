// Transitions entre deux diapos.
//
// Le changement de diapo était une coupe sèche. Ça fonctionne, mais à l'écran
// ça saute — et c'est l'un des rares détails que toute l'assemblée remarque.
//
// ⚠ Contrainte réelle de cette application : le compositing de WebKitGTK est
// désactivé au démarrage (`WEBKIT_DISABLE_COMPOSITING_MODE=1`, voir
// ARCHITECTURE §5), sinon la fenêtre reste noire sur beaucoup de machines.
// Les animations sont donc calculées par le processeur, pas par la carte
// graphique. Deux conséquences qui expliquent les choix ci-dessous :
//
//   1. On n'anime QUE `opacity`, `transform` et `filter` — jamais une
//      géométrie (largeur, marges), qui forcerait un recalcul de mise en page
//      à chaque image.
//   2. Les durées restent courtes. Au-delà d'une demi-seconde, une animation
//      logicielle sur un écran de projection se voit saccader.

export type TransitionType =
  | "none"
  | "fade"
  | "fade-black"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "zoom-in"
  | "zoom-out"
  | "blur";

export type TransitionSettings = {
  type: TransitionType;
  /** Durée en millisecondes. */
  duration: number;
};

export const DEFAULT_TRANSITION: TransitionSettings = { type: "fade", duration: 280 };

export const TRANSITIONS: { value: TransitionType; label: string; hint: string }[] = [
  { value: "none", label: "Aucune (coupe)", hint: "Changement instantané" },
  { value: "fade", label: "Fondu", hint: "Le plus discret — recommandé" },
  { value: "fade-black", label: "Fondu au noir", hint: "Passe par un noir, marque la rupture" },
  { value: "slide-left", label: "Glissement ←", hint: "La diapo entre par la droite" },
  { value: "slide-right", label: "Glissement →", hint: "La diapo entre par la gauche" },
  { value: "slide-up", label: "Glissement ↑", hint: "Entre par le bas" },
  { value: "slide-down", label: "Glissement ↓", hint: "Entre par le haut" },
  { value: "zoom-in", label: "Zoom avant", hint: "La diapo s'approche" },
  { value: "zoom-out", label: "Zoom arrière", hint: "La diapo s'éloigne" },
  { value: "blur", label: "Flou", hint: "Mise au point progressive" },
];

export function withTransitionDefaults(t?: Partial<TransitionSettings> | null): TransitionSettings {
  const merged = { ...DEFAULT_TRANSITION, ...(t || {}) };
  // Une durée aberrante enregistrée par erreur bloquerait l'affichage de la
  // diapo suivante pendant plusieurs secondes, en plein culte.
  merged.duration = Math.min(1200, Math.max(0, merged.duration));
  return merged;
}

/**
 * Noms des classes d'animation, définies dans `src/index.css`.
 * Le suffixe `-in` est joué par la diapo qui arrive, `-out` par celle qui part.
 */
export function transitionClasses(type: TransitionType): { enter: string; exit: string } {
  if (type === "none") return { enter: "", exit: "" };
  return { enter: `slide-anim-${type}-in`, exit: `slide-anim-${type}-out` };
}

/**
 * Vrai si l'ancienne diapo doit rester affichée pendant l'animation.
 *
 * ⚠ Jamais pour une vidéo ou un PDF : garder l'ancien élément une demi-seconde
 * de plus, c'est un second décodage simultané de la même vidéo (voir
 * ARCHITECTURE §1), soit exactement le gel qu'on cherche à éviter. Sur ces
 * contenus, seule la diapo entrante est animée.
 */
export function keepsPreviousLayer(mediaType?: string | null): boolean {
  if (!mediaType) return true; // du texte : aucun coût
  return mediaType === "markdown";
}
