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

// ---------------------------------------------------------------------------
// Découpage automatique des diapos trop longues
//
// Complément de l'alerte de débordement : plutôt que de réduire la police
// jusqu'à l'illisible, on coupe un verset trop long en deux écrans.
//
// DÉSACTIVÉ par défaut, et volontairement : découper change la numérotation
// des diapos. Un opérateur qui connaît son recueil par cœur ne doit pas voir
// sa strophe 3 devenir la 4 sans l'avoir demandé.
//
// Le texte ENREGISTRÉ n'est jamais modifié : le découpage n'existe qu'à
// l'affichage, donc revenir en arrière ne coûte rien.
// ---------------------------------------------------------------------------

export type SplitOptions = {
  enabled: boolean;
  /** Au-delà de cette longueur, la diapo est coupée. */
  maxChars: number;
};

export const DEFAULT_SPLIT: SplitOptions = { enabled: false, maxChars: 220 };

export function withSplitDefaults(s?: Partial<SplitOptions> | null): SplitOptions {
  const merged = { ...DEFAULT_SPLIT, ...(s || {}) };
  // En dessous de 80 caractères on couperait des phrases courtes en deux.
  merged.maxChars = Math.min(900, Math.max(80, merged.maxChars));
  return merged;
}

/**
 * Meilleur point de coupure d'un texte, le plus près possible du milieu.
 *
 * Ordre de préférence : fin de phrase, puis ponctuation faible, puis retour à
 * la ligne, puis espace. Couper après un point de phrase donne deux diapos qui
 * se lisent chacune ; couper au milieu d'une proposition ne veut rien dire
 * pour l'assemblée.
 */
function bestCut(text: string): number | null {
  const middle = text.length / 2;
  const candidates: { index: number; rank: number }[] = [];

  const scan = (re: RegExp, rank: number) => {
    for (const m of text.matchAll(re)) {
      // On coupe APRÈS le séparateur, pour qu'il reste sur la première diapo.
      const index = m.index! + m[0].length;
      if (index > 8 && index < text.length - 8) candidates.push({ index, rank });
    }
  };

  scan(/[.!?…]["»']?\s+/g, 0); // fin de phrase
  scan(/[;:]\s+/g, 1);
  scan(/,\s+/g, 2);
  scan(/\n/g, 1); // un retour à la ligne vaut une ponctuation faible
  scan(/\s+/g, 3); // dernier recours : n'importe quel espace

  if (candidates.length === 0) return null;

  // On prend le meilleur rang disponible, puis le plus proche du milieu :
  // deux diapos équilibrées valent mieux qu'une pleine et une presque vide.
  const bestRank = Math.min(...candidates.map((c) => c.rank));
  return candidates
    .filter((c) => c.rank === bestRank)
    .sort((a, b) => Math.abs(a.index - middle) - Math.abs(b.index - middle))[0].index;
}

/** Découpe une diapo tant qu'elle dépasse la longueur voulue. */
export function splitLongSlide(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const cut = bestCut(text);
  // Aucun point de coupure (un seul mot très long) : on laisse tel quel
  // plutôt que de couper au milieu d'un mot.
  if (cut === null) return [text];
  return [
    ...splitLongSlide(text.slice(0, cut).trimEnd(), maxChars),
    ...splitLongSlide(text.slice(cut).trimStart(), maxChars),
  ];
}

/** Diapos d'un élément, dans l'ordre de projection. Toujours au moins une. */
export function getSlides(song: any, split?: Partial<SplitOptions> | null): string[] {
  const raw: string = song?.lyrics ?? "";
  if (!raw.trim()) return [""];

  if (isMarkdown(song)) {
    const parts = raw
      .split(new RegExp(MARKDOWN_SLIDE_SEPARATOR.source, "m"))
      .map((s) => s.replace(/^\n+|\n+$/g, ""))
      .filter((s) => s.trim().length > 0);
    // Les diapos Markdown sont découpées à la main par l'auteur : les
    // recouper automatiquement casserait une mise en page voulue.
    return parts.length > 0 ? parts : [raw];
  }

  const slides = raw.split(/\n\s*\n/);
  const opts = withSplitDefaults(split);
  if (!opts.enabled) return slides;
  return slides.flatMap((s) => splitLongSlide(s, opts.maxChars));
}

/** Diapo courante, index borné pour ne jamais sortir du tableau. */
export function getSlide(song: any, index: number, split?: Partial<SplitOptions> | null): string {
  const slides = getSlides(song, split);
  const safe = Math.max(0, Math.min(index, slides.length - 1));
  return slides[safe] ?? "";
}
