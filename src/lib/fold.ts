// Normalisation « sans accent ni casse », jumelle de `fold()` dans
// src-tauri/src/lib.rs.
//
// Les deux existent parce qu'elles servent à deux moments différents : Rust
// FILTRE les 31 000 versets, l'interface SURLIGNE les mots trouvés dans les
// résultats. Si l'une change, changer l'autre — sinon un mot apparaît dans les
// résultats sans être mis en évidence.

const MAP: Record<string, string> = {
  à: "a", á: "a", â: "a", ã: "a", ä: "a", å: "a", ā: "a",
  æ: "ae",
  ç: "c", ć: "c", č: "c",
  è: "e", é: "e", ê: "e", ë: "e", ē: "e", ė: "e",
  ì: "i", í: "i", î: "i", ï: "i", ī: "i",
  ñ: "n", ń: "n",
  ò: "o", ó: "o", ô: "o", õ: "o", ö: "o", ø: "o", ō: "o",
  œ: "oe",
  š: "s", ś: "s",
  ù: "u", ú: "u", û: "u", ü: "u", ū: "u",
  ý: "y", ÿ: "y",
  ž: "z", ź: "z",
  "‘": "'", "’": "'", "ʼ": "'",
};

export function fold(input: string): string {
  let out = "";
  for (const c of input.toLowerCase()) out += MAP[c] ?? c;
  return out;
}

/**
 * Termes recherchés, normalisés. Entre guillemets, la saisie compte pour une
 * seule expression exacte — même règle que `search_terms()` côté Rust.
 */
export function searchTerms(query: string): string[] {
  const folded = fold(query.trim());
  if (folded.length >= 2 && folded.startsWith('"') && folded.endsWith('"')) {
    const phrase = folded.slice(1, -1).trim();
    return phrase ? [phrase] : [];
  }
  return folded.split(/\s+/).filter(Boolean);
}
