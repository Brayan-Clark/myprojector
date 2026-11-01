import { describe, expect, it } from "vitest";
import { fold, searchTerms } from "./fold";

/**
 * ⚠ `fold()` est la JUMELLE de la fonction du même nom dans
 * `src-tauri/src/lib.rs`. Rust FILTRE les 31 000 versets, l'interface
 * SURLIGNE les mots trouvés. Si l'une change sans l'autre, un mot apparaît
 * dans les résultats sans être mis en évidence — et personne ne comprend
 * pourquoi.
 *
 * Ces tests fixent le contrat côté interface. Toute modification ici doit être
 * reportée côté Rust.
 */
describe("fold", () => {
  it("met en minuscules", () => {
    expect(fold("FIANGONANA")).toBe("fiangonana");
  });

  it("retire les accents des langues visées", () => {
    expect(fold("Église")).toBe("eglise");
    expect(fold("Kôlosiana")).toBe("kolosiana");
    expect(fold("fitiavana ÿ")).toBe("fitiavana y");
  });

  it("développe les ligatures", () => {
    expect(fold("cœur")).toBe("coeur");
    expect(fold("Æsop")).toBe("aesop");
  });

  /**
   * Les apostrophes typographiques sont ramenées à l'apostrophe droite : le
   * malgache en est truffé (« Asan'ny », « Mofon'aina ») et l'opérateur tape
   * celle de son clavier, pas celle du texte.
   */
  it("unifie les apostrophes", () => {
    expect(fold("Asan’ny")).toBe("asan'ny");
    expect(fold("Mofonʼaina")).toBe("mofon'aina");
    expect(fold("Asan‘ny")).toBe("asan'ny");
  });

  it("laisse passer ce qu'elle ne connaît pas", () => {
    expect(fold("abc 123 !?")).toBe("abc 123 !?");
    expect(fold("")).toBe("");
  });
});

describe("searchTerms", () => {
  it("découpe la saisie en mots normalisés", () => {
    expect(searchTerms("Fitiavana  ÉGLISE")).toEqual(["fitiavana", "eglise"]);
  });

  it("traite une saisie entre guillemets comme une seule expression", () => {
    expect(searchTerms('"fitiavan\'Andriamanitra lehibe"'))
      .toEqual(["fitiavan'andriamanitra lehibe"]);
  });

  it("ignore des guillemets vides", () => {
    expect(searchTerms('""')).toEqual([]);
    expect(searchTerms('"   "')).toEqual([]);
  });

  it("renvoie une liste vide pour une saisie vide", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   ")).toEqual([]);
  });

  it("ne confond pas un guillemet isolé avec une expression", () => {
    expect(searchTerms('"fitiavana')).toEqual(['"fitiavana']);
  });
});
