import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cleanUrl } from "../lib/media";

const VIDEO_EXT = /\.(mp4|webm|ogg|mov|mkv|m4v)(\?.*)?$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)(\?.*)?$/i;

type Variant = "projection" | "preview" | "editor";

/**
 * Rendu Markdown pour l'agenda : GFM (tableaux, listes de tâches), maths
 * KaTeX (`$…$` et `$$…$$`), images, vidéos et audios.
 *
 * Le HTML brut n'est volontairement PAS interprété. Les médias passent par la
 * syntaxe image — `![](clip.mp4)` produit une vidéo, `![](chant.mp3)` un
 * lecteur audio — ce qui couvre le besoin sans ouvrir la porte à l'injection
 * de balises arbitraires dans la fenêtre de projection.
 *
 * Toutes les sources locales passent par cleanUrl() : elles sont donc servies
 * par le serveur local, comme le reste des médias de l'application.
 */
export const MarkdownView = memo(({ content, variant = "preview", style, className = "" }: {
  content: string;
  variant?: Variant;
  /**
   * Mise en forme héritée de la présentation (police, couleur, alignement,
   * taille). À la projection, une diapo Markdown doit suivre les mêmes réglages
   * que les autres : elle n'est pas un îlot avec sa propre typographie.
   */
  style?: React.CSSProperties;
  className?: string;
}) => {
  // Une taille imposée par l'appelant remplace l'échelle par défaut ; les
  // titres et listes restent en `em`, donc tout suit proportionnellement.
  const scale = style?.fontSize
    ? "leading-relaxed"
    : variant === "projection" ? "text-[2.2vw] leading-relaxed"
    : variant === "editor" ? "text-sm"
    : "text-xs";

  return (
    <div className={`markdown-body ${scale} ${className} w-full`} style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          img({ src, alt, title }) {
            const raw = typeof src === "string" ? src : "";
            const url = cleanUrl(raw) || raw;
            if (VIDEO_EXT.test(raw)) {
              return (
                <video
                  src={url}
                  controls
                  playsInline
                  preload="metadata"
                  className="mx-auto my-4 max-h-[70vh] max-w-full rounded"
                />
              );
            }
            if (AUDIO_EXT.test(raw)) {
              return <audio src={url} controls preload="none" className="my-3 w-full" />;
            }
            return (
              <img
                src={url}
                alt={alt || ""}
                title={title}
                className="mx-auto my-4 max-h-[70vh] max-w-full rounded object-contain"
              />
            );
          },
          a({ href, children }) {
            // Pas de navigation depuis l'écran de projection.
            return <span className="underline decoration-dotted" title={href}>{children}</span>;
          },
          table({ children }) {
            return (
              <div className="my-4 overflow-x-auto">
                <table className="w-full border-collapse">{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
