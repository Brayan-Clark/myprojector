// Résolution d'une référence biblique saisie au clavier.
//
// Extrait de `LeftSidebar.tsx`, où la logique vivait dans un `useEffect` : elle
// n'était donc testable qu'en montant le composant, avec une base chargée. Or
// c'est le code le plus exposé de l'application — l'opérateur tape « Jao 3:16 »
// en direct, devant l'assemblée — et il a DÉJÀ eu un bug en production sur les
// livres dont le nom commence par un chiffre (voir `resolveBook`).
//
// Tout est pur ici : aucune dépendance à React, aucun accès à la base.

/** Une référence telle que l'opérateur l'a tapée, une fois découpée. */
export interface ParsedRef {
  /** Le nom du livre, brut (« 1 Jaona », « 1jao », « Jao. »). */
  bookAlias: string;
  /** Numéro de chapitre, en chaîne : c'est la forme stockée par MyBible. */
  chapter: string;
  verseStart?: string;
  verseEnd?: string;
}

/**
 * Normalisation « sans accent, sans espace, sans ponctuation ».
 *
 * « 1Jao », « 1 Jaona » et « 1jao. » doivent mener au même livre : on compare
 * donc des formes réduites aux seuls caractères alphanumériques.
 */
export function normalizeBookName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Découpe une saisie en référence.
 *
 * ⚠ Le nom du livre peut commencer par un chiffre ET contenir une espace
 * (« 1 Jaona »), ou être collé (« 1Jao »). Le motif d'origine exigeait des
 * caractères contigus : AUCUNE référence en 1/2/3 ne fonctionnait. Le chiffre
 * de tête est donc capturé séparément de l'espace qui peut le suivre.
 *
 * Les séparateurs acceptés entre chapitre et verset sont `:`, `.` et l'espace,
 * parce que les trois sont tapés en pratique.
 */
export function parseBibleRef(query: string): ParsedRef | null {
  const match = query.match(
    /^\s*(\d?\s*[^\d\s.:,;]+)\s*[.\s]*(\d+)\s*[:.\s]*(\d+)?\s*-?\s*(\d+)?/i
  );
  if (!match) return null;
  const [, bookAlias, chapter, verseStart, verseEnd] = match;
  if (!bookAlias?.trim() || !chapter) return null;
  return {
    bookAlias: bookAlias.trim(),
    chapter,
    verseStart: verseStart || undefined,
    verseEnd: verseEnd || undefined,
  };
}

/**
 * Retrouve le nom exact du livre à partir de ce qui a été tapé.
 *
 * `abbrOf` donne l'abréviation officielle d'un livre (`books.short_name`,
 * exposé par la commande Rust sous le champ `abbr`).
 *
 * ⚠ On compare dans LES DEUX SENS. « 1jao » doit trouver « 1 Jaona » (la
 * saisie est un préfixe du nom), et « 1jaona » doit trouver le livre dont
 * l'abrégé est « 1jao » (l'abrégé est un préfixe de la saisie). Ne tester
 * qu'un seul sens laissait la moitié des cas sans résultat.
 *
 * ⚠ `long_name` contient une espace après le chiffre : un
 * `startsWith("1jao")` sur le nom NON normalisé échoue. C'était la cause de
 * l'échec des recherches sur les livres commençant par un chiffre.
 */
export function resolveBook(
  alias: string,
  books: string[],
  abbrOf: (book: string) => string | undefined
): string | null {
  const needle = normalizeBookName(alias);
  if (!needle) return null;

  // Priorité au nom complet : « Jao » ne doit pas être détourné par
  // l'abréviation d'un autre livre.
  const byName = books.find((b) => normalizeBookName(b).startsWith(needle));
  if (byName) return byName;

  const byAbbr = books.find((b) => {
    const abbr = normalizeBookName(abbrOf(b));
    return abbr !== "" && (abbr.startsWith(needle) || needle.startsWith(abbr));
  });
  return byAbbr || null;
}
