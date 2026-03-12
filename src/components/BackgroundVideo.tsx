import { useEffect, useRef, memo } from "react";

export const BackgroundVideo = memo(({ src, muted = true, opacity = 1 }: { src: string, muted?: boolean, opacity?: number }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    // Lifecycle management to prevent GStreamer hangs on Linux
    return () => {
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.src = "";
          videoRef.current.load();
        } catch (e) {
          console.error("Error cleaning up video:", e);
        }
      }
    };
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      loop
      muted={muted}
      playsInline
      preload="auto"
      crossOrigin="anonymous"
      className="w-full h-full object-cover"
      style={{ opacity }}
    />
  );
});
