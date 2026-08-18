import { useEffect, useRef, memo } from "react";
import { forceBackgroundPlayback } from "../lib/autoplay";

/**
 * Vidéo de FOND : toujours muette, toujours en boucle, jamais de contrôles.
 * Toute la logique de démarrage (et de diagnostic) vit dans `forceBackgroundPlayback`,
 * car WebKitGTK ne respecte pas l'attribut `autoplay` de façon fiable.
 */
export const BackgroundVideo = memo(
  ({ src, opacity = 1, className = "w-full h-full object-cover", style, label = "Background Video" }: {
    src: string;
    opacity?: number;
    className?: string;
    style?: React.CSSProperties;
    label?: string;
  }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
      const el = videoRef.current;
      if (!el) return;
      return forceBackgroundPlayback(el, src, label);
    }, [src, label]);

    return (
      <video
        ref={videoRef}
        key={src}
        /* `src` est posé par forceBackgroundPlayback (voir le commentaire là-bas) */
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        controls={false}
        className={className}
        style={{ opacity, display: "block", ...style }}
      />
    );
  }
);
