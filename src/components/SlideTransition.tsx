import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  transitionClasses, withTransitionDefaults, type TransitionSettings,
} from "../lib/transitions";

/**
 * Joue une transition quand la diapo change.
 *
 * Principe : au changement de `contentKey`, l'ANCIEN rendu est conservé dans
 * une couche superposée le temps de l'animation, pendant que le nouveau entre.
 * Un élément React est un descripteur immuable : garder celui d'avant affiche
 * bien l'ancienne diapo, sans refaire de calcul.
 *
 * `contentKey` et non les enfants eux-mêmes : les enfants changent d'identité
 * à chaque rendu du parent (horloge qui bat la seconde, etc.). Déclencher
 * là-dessus relancerait une animation toutes les secondes.
 *
 * ⚠ `keepPrevious={false}` est OBLIGATOIRE pour une vidéo ou un PDF projeté :
 * garder l'ancienne couche signifierait deux décodages simultanés de la même
 * vidéo — le gel que toute l'architecture cherche à éviter.
 */
export function SlideTransition({
  contentKey,
  settings,
  keepPrevious = true,
  className = "relative",
  children,
}: {
  contentKey: string;
  settings?: Partial<TransitionSettings> | null;
  keepPrevious?: boolean;
  /**
   * Doit POSITIONNER le conteneur (`relative`, ou `absolute inset-0`) : les
   * deux couches se superposent en absolu par rapport à lui.
   */
  className?: string;
  children: ReactNode;
}) {
  const { type, duration } = withTransitionDefaults(settings);
  const { enter, exit } = transitionClasses(type);

  const [previous, setPrevious] = useState<{ key: string; node: ReactNode } | null>(null);
  // `key` suit la diapo affichée ; `node` garde le rendu précédent.
  const current = useRef<{ key: string; node: ReactNode }>({ key: contentKey, node: children });
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const previousEntry = current.current;
    current.current = { key: contentKey, node: children };
    if (previousEntry.key === contentKey) return; // même diapo, contenu rafraîchi

    if (type === "none" || duration === 0) {
      setPrevious(null);
      return;
    }
    if (keepPrevious) setPrevious(previousEntry);

    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPrevious(null), duration);
    // `children` est volontairement hors des dépendances : seul le changement
    // de diapo déclenche une transition (voir le commentaire plus haut).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, type, duration, keepPrevious]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (type === "none" || duration === 0) {
    return <div className={className}>{children}</div>;
  }

  const style = { animationDuration: `${duration}ms` };

  return (
    <div className={className}>
      {previous && (
        <div
          key={`out-${previous.key}`}
          className={`slide-layer pointer-events-none absolute inset-0 ${exit}`}
          style={style}
          aria-hidden
        >
          {previous.node}
        </div>
      )}
      <div key={`in-${contentKey}`} className={`slide-layer absolute inset-0 ${enter}`} style={style}>
        {children}
      </div>
      {type === "fade-black" && previous && (
        /* Le voile n'existe que le temps du passage : laissé en place, il
           assombrirait la diapo suivante. */
        <div
          key={`veil-${contentKey}`}
          className="slide-layer slide-black-veil pointer-events-none absolute inset-0 bg-black"
          style={style}
          aria-hidden
        />
      )}
    </div>
  );
}
