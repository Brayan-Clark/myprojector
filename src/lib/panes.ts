// Tailles des panneaux de l'interface de contrôle.
//
// Les colonnes étaient figées (`w-80`, `w-96`) : impossible d'agrandir
// l'aperçu de projection ou la liste des diapos selon l'écran et le besoin du
// moment. Chaque taille est désormais glissable et retenue d'une séance à
// l'autre — un opérateur retrouve SON agencement sans le refaire.

import { useCallback, useEffect, useState } from "react";

export type PaneBounds = { min: number; max: number };

/** Limites volontairement larges, mais jamais jusqu'à faire disparaître un panneau. */
export const PANES = {
  left: { key: "paneLeftWidth", def: 320, min: 220, max: 680 },
  right: { key: "paneRightWidth", def: 384, min: 260, max: 900 },
  agenda: { key: "paneAgendaHeight", def: 260, min: 90, max: 1000 },
} as const;

export function clamp(value: number, { min, max }: PaneBounds) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Taille persistée d'un panneau, en pixels.
 *
 * Le second élément du tuple est volontairement un setter « brut » : la poignée
 * de redimensionnement borne déjà la valeur, et borner une seconde fois ici
 * empêcherait d'écrire une valeur que la fenêtre vient d'agrandir.
 */
export function usePaneSize(pane: { key: string; def: number; min: number; max: number }) {
  const [size, setSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem(pane.key));
    return Number.isFinite(saved) && saved > 0
      ? clamp(saved, { min: pane.min, max: pane.max })
      : pane.def;
  });

  useEffect(() => {
    localStorage.setItem(pane.key, String(Math.round(size)));
  }, [pane.key, size]);

  const reset = useCallback(() => setSize(pane.def), [pane.def]);

  return [size, setSize, reset] as const;
}
