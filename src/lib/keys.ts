// Touches envoyées par les télécommandes de présentation (clickers Bluetooth
// ou USB). Elles se déclarent au système comme un clavier : aucun code
// Bluetooth n'est nécessaire côté application, il suffit d'écouter ces touches.
//
// Correspondances usuelles des modèles du marché (Logitech, Baseus, Kensington…) :
//   Page suivante   -> PageDown, Flèche droite, Flèche bas
//   Page précédente -> PageUp,   Flèche gauche, Flèche haut
//   Écran noir      -> point « . » ou touche B
//   Démarrer/Quitter-> F5 / Échap

export const NEXT_KEYS = ["ArrowDown", "ArrowRight", "PageDown"];
export const PREV_KEYS = ["ArrowUp", "ArrowLeft", "PageUp"];

/**
 * Vrai si la frappe doit être ignorée parce que l'utilisateur est en train
 * d'écrire. Sans ce garde-fou, taper une flèche dans un champ de recherche
 * ferait défiler la projection.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

/** Liste des diapos de la colonne de droite (voir `focusSlideList`). */
export const SLIDE_LIST_ID = "slide-list";

/**
 * Rend la main au clavier de navigation.
 *
 * Le piège : on cherche un chant, on projette avec Alt+Entrée… et le focus
 * reste dans le champ de recherche. `isTypingTarget` bloque alors les flèches
 * — à juste titre, sinon taper une référence ferait défiler la projection —
 * et plus rien ne répondait sans aller cliquer dans la liste à la souris.
 *
 * On appelle donc ceci dès qu'une action signifie « j'ai fini de chercher » :
 * projeter, démarrer la présentation, valider ou quitter une recherche.
 */
export function focusSlideList() {
  const active = document.activeElement as HTMLElement | null;
  if (active && isTypingTarget(active)) active.blur();
  // `preventScroll` : la liste défile déjà d'elle-même vers la diapo active,
  // un second recentrage du navigateur la faisait sauter.
  document.getElementById(SLIDE_LIST_ID)?.focus({ preventScroll: true });
}
