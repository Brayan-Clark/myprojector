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

  const animated = type !== "none" && duration > 0;

  /**
   * Couche sortante, décidée PENDANT le rendu.
   *
   * ⚠ C'était fait dans un `useEffect`, donc une image trop tard. Le
   * déroulement était le suivant :
   *
   *   1. la diapo change, React remplace la couche (sa `key` change) :
   *      l'ancienne disparaît du DOM ;
   *   2. le navigateur peut peindre cette image — la nouvelle diapo y est
   *      encore à `opacity: 0`, donc l'écran est VIDE ;
   *   3. l'effet s'exécute enfin et réinsère l'ancienne pour qu'elle
   *      s'efface.
   *
   * L'ancienne diapo disparaissait donc, puis revenait : c'est le
   * clignotement qu'on voyait à chaque changement. Mettre l'état à jour
   * pendant le rendu fait recommencer le rendu immédiatement, AVANT toute
   * peinture : les deux couches arrivent dans la même image.
   */
  const [shown, setShown] = useState<{ key: string; prev: { key: string; node: ReactNode } | null }>(
    () => ({ key: contentKey, prev: null })
  );
  const lastChildren = useRef<ReactNode>(children);

  if (shown.key !== contentKey) {
    setShown({
      key: contentKey,
      prev: animated && keepPrevious ? { key: shown.key, node: lastChildren.current } : null,
    });
  }
  // Après la comparaison : on garde le rendu de CETTE diapo pour le jour où
  // elle deviendra la sortante.
  lastChildren.current = children;

  const previous = shown.prev;

  // Retrait de la couche sortante quand l'animation est finie.
  useEffect(() => {
    if (!previous) return;
    const t = window.setTimeout(
      () => setShown((s) => (s.prev ? { ...s, prev: null } : s)),
      duration
    );
    return () => window.clearTimeout(t);
  }, [previous, duration]);

  if (!animated) {
    return <div className={className}>{children}</div>;
  }

  const style = { animationDuration: `${duration}ms` };

  return (
    <div className={className}>
      {previous && (
        <div
          key={`out-${previous.key}`}
          className={`slide-layer slide-exit pointer-events-none absolute inset-0 ${exit}`}
          style={style}
          aria-hidden
        >
          {previous.node}
        </div>
      )}
      <div key={`in-${contentKey}`} className={`slide-layer slide-enter absolute inset-0 ${enter}`} style={style}>
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
