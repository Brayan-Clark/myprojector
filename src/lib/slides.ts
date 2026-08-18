// Découpage d'un élément en "diapos" projetables.
//
// Les chants et textes se découpent sur les lignes vides (une strophe par
// écran). Le Markdown, lui, se découpe sur les barres horizontales `---`,
// convention habituelle des présentations : l'opérateur avance ensuite avec
// les mêmes touches que pour une strophe.

export const MARKDOWN_SLIDE_SEPARATOR = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m;

export function isMarkdown(song: any): boolean {
  return song?.type === "markdown";
}

/** Diapos d'un élément, dans l'ordre de projection. Toujours au moins une. */
export function getSlides(song: any): string[] {
  const raw: string = song?.lyrics ?? "";
  if (!raw.trim()) return [""];

  if (isMarkdown(song)) {
    const parts = raw
      .split(new RegExp(MARKDOWN_SLIDE_SEPARATOR.source, "m"))
      .map((s) => s.replace(/^\n+|\n+$/g, ""))
      .filter((s) => s.trim().length > 0);
    return parts.length > 0 ? parts : [raw];
  }

  return raw.split(/\n\s*\n/);
}

/** Diapo courante, index borné pour ne jamais sortir du tableau. */
export function getSlide(song: any, index: number): string {
  const slides = getSlides(song);
  const safe = Math.max(0, Math.min(index, slides.length - 1));
  return slides[safe] ?? "";
}
