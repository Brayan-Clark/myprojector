import { useEffect, useRef, memo } from "react";
import { describeVideoError, releaseVideo } from "../lib/autoplay";

/**
 * Vidéo projetée depuis l'agenda : contrôles visibles (pause, son, avance).
 *
 * Contrairement au fond, elle est démontée dès qu'on passe à l'élément suivant.
 * C'est ce démontage qui figeait l'application plusieurs secondes : on coupe
 * donc la source avant que React ne retire le noeud du DOM.
 */
export const ProjectedVideo = memo(
  ({ src, controls = true, muted = false, className = "w-full h-full object-contain", label = "Vidéo projetée" }: {
    src: string;
    controls?: boolean;
    /** L'aperçu du contrôleur DOIT être muet : sinon le son sort en double. */
    muted?: boolean;
    className?: string;
    label?: string;
  }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
      const el = videoRef.current;
      if (!el) return;

      // La source est posée ici, pas via l'attribut JSX : le nettoyage la retire
      // pour libérer le pipeline GStreamer, et React ne la remettrait jamais.
      // Sous StrictMode (double montage des effets) la vidéo restait sinon vide.
      if (el.getAttribute("src") !== src) {
        el.setAttribute("src", src);
        el.load();
      }

      // WebKitGTK ignore `autoplay` : on relance sur plusieurs événements.
      const tryPlay = () => el.play().catch((e) => console.warn(`[${label}] play():`, e));
      el.addEventListener("loadeddata", tryPlay);
      el.addEventListener("canplay", tryPlay);
      tryPlay();

      return () => {
        el.removeEventListener("loadeddata", tryPlay);
        el.removeEventListener("canplay", tryPlay);
        releaseVideo(el);
      };
    }, [src, label]);

    return (
      <video
        ref={videoRef}
        key={src}
        className={className}
        autoPlay
        controls={controls}
        muted={muted}
        playsInline
        preload="auto"
        style={{ display: "block" }}
        onError={(e) => console.error(`[${label}] ${describeVideoError(e.currentTarget)} | src=${src}`)}
      />
    );
  }
);
