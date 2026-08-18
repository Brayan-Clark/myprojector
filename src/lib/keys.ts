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
