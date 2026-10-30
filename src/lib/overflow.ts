import { useLayoutEffect, useRef, useState } from "react";

// Détection de débordement du texte projeté.
//
// Le cas qui arrive vraiment : un verset long, ou deux versions affichées
// ensemble, et la dernière ligne sort de l'écran. Personne ne le voit sur le
// poste de contrôle — jusqu'à ce que l'assemblée le voie, elle.
//
// Ce n'était pas détectable avant : le mini-moniteur affichait le texte à une
// taille fixe. Depuis qu'il reproduit les proportions réelles de l'écran, un
// simple `scrollHeight > clientHeight` dit la vérité.

export type OverflowState = {
  /** Vrai si le contenu dépasse le cadre. */
  overflowing: boolean;
  /** De combien, en pourcentage de la hauteur du cadre. */
  excess: number;
};

/**
 * Surveille le débordement d'un élément.
 *
 * `useLayoutEffect` : la mesure a lieu après la mise en page, avant que
 * l'écran ne soit peint. Avec `useEffect`, l'alerte apparaîtrait une image
 * plus tard, ce qui la ferait clignoter à chaque changement de diapo.
 *
 * `deps` doit contenir tout ce qui change la mise en page : le texte, la
 * taille de police, l'interligne, la largeur du cadre…
 */
export function useOverflow(deps: unknown[]): [React.RefObject<HTMLDivElement | null>, OverflowState] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<OverflowState>({ overflowing: false, excess: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const box = el.clientHeight;
      if (box === 0) return;
      // Le texte est centré verticalement : il déborde alors en haut ET en
      // bas, et `scrollHeight` du conteneur ignore la partie haute. On mesure
      // donc le bloc de contenu lui-même quand il y en a un.
      const content = el.firstElementChild as HTMLElement | null;
      const contentHeight = content ? content.scrollHeight : el.scrollHeight;
      // Marge de 2 % : une diapo qui tient au pixel près n'est pas un problème,
      // et les arrondis de rendu feraient clignoter l'alerte.
      const excess = ((contentHeight - box) / box) * 100;
      const overflowing = excess > 2;
      setState((prev) =>
        prev.overflowing === overflowing && Math.abs(prev.excess - excess) < 1
          ? prev
          : { overflowing, excess: Math.max(0, excess) }
      );
    };

    measure();
    // Le cadre change de taille quand on tire la poignée de la colonne : sans
    // observateur, l'alerte resterait figée sur l'ancienne mesure.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [ref, state];
}

/**
 * Taille de police qui ferait tenir le texte.
 *
 * La hauteur d'un bloc de texte est à peu près proportionnelle à la taille de
 * police. On applique donc le rapport inverse du débordement, avec 4 % de
 * marge — assez pour absorber le fait que le nombre de retours à la ligne, lui,
 * ne varie pas de façon continue.
 */
export function fittingFontSize(current: number, excessPercent: number): number {
  const ratio = 100 / (100 + excessPercent);
  return Math.max(20, Math.round(current * ratio * 0.96));
}
