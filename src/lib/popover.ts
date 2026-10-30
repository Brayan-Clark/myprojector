import { useLayoutEffect, useRef, useState } from "react";

/**
 * Bascule un panneau déroulant à droite de son bouton quand il déborderait de
 * la fenêtre.
 *
 * Les panneaux s'ouvrent naturellement vers la droite depuis leur bouton. Ceux
 * du dernier groupe de la barre d'outils — justement les réglages de fond —
 * sortaient donc de l'écran : la moitié des curseurs était inatteignable.
 *
 * La mesure a lieu après le rendu et avant l'affichage (`useLayoutEffect`),
 * pour qu'on ne voie jamais le panneau sauter d'un côté à l'autre.
 */
export function useFlipAlign(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState<"left" | "right">("left");

  useLayoutEffect(() => {
    if (!open) {
      setAlign("left");
      return;
    }
    const el = ref.current;
    if (!el) return;
    // On repart systématiquement de la gauche avant de mesurer : sinon un
    // panneau déjà basculé se mesure dans sa position corrigée et oscille.
    const rect = el.getBoundingClientRect();
    const overflowRight = rect.right > window.innerWidth - 8;
    const fitsOnLeft = rect.right - rect.width - 8 > 0;
    setAlign(overflowRight && fitsOnLeft ? "right" : "left");
  }, [open]);

  return [ref, align] as const;
}
