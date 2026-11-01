import { describe, expect, it } from "vitest";
import { normalizeBookName, parseBibleRef, resolveBook } from "./bibleRef";

/**
 * Les livres tels qu'une bible malgache les expose, avec leur abréviation
 * officielle (`books.short_name`).
 *
 * ⚠ Noter l'ESPACE après le chiffre dans « 1 Jaona » : c'est précisément ce
 * détail qui faisait échouer toutes les recherches sur les livres numérotés.
 */
const BOOKS = ["Genesisy", "Salamo", "Jaona", "1 Jaona", "2 Jaona", "Isaia", "Asan'ny Apostoly"];
const ABBR: Record<string, string> = {
  Genesisy: "Gen.",
  Salamo: "Sal.",
  Jaona: "Jao.",
  "1 Jaona": "1 Jao.",
  "2 Jaona": "2 Jao.",
  Isaia: "Isa.",
  "Asan'ny Apostoly": "Asa.",
};
const abbrOf = (book: string) => ABBR[book];

describe("normalizeBookName", () => {
  it("retire accents, espaces et ponctuation", () => {
    expect(normalizeBookName("1 Jaona")).toBe("1jaona");
    expect(normalizeBookName("Jao.")).toBe("jao");
    expect(normalizeBookName("Asan'ny Apostoly")).toBe("asannyapostoly");
    expect(normalizeBookName("Ésaïe")).toBe("esaie");
  });

  it("tolère null et undefined plutôt que de lever", () => {
    // Appelé sur `song?.abbr`, qui est souvent absent.
    expect(normalizeBookName(undefined)).toBe("");
    expect(normalizeBookName(null)).toBe("");
  });
});

describe("parseBibleRef", () => {
  it("lit un livre, un chapitre et un verset", () => {
    expect(parseBibleRef("Jaona 3:16")).toEqual({
      bookAlias: "Jaona", chapter: "3", verseStart: "16", verseEnd: undefined,
    });
  });

  it("accepte les trois séparateurs tapés en pratique", () => {
    for (const q of ["Jao 3:16", "Jao 3.16", "Jao 3 16"]) {
      expect(parseBibleRef(q)).toMatchObject({ chapter: "3", verseStart: "16" });
    }
  });

  it("lit un intervalle de versets", () => {
    expect(parseBibleRef("Sal 23:1-6")).toMatchObject({
      chapter: "23", verseStart: "1", verseEnd: "6",
    });
  });

  it("accepte un chapitre seul", () => {
    expect(parseBibleRef("Genesisy 1")).toEqual({
      bookAlias: "Genesisy", chapter: "1", verseStart: undefined, verseEnd: undefined,
    });
  });

  // La régression historique : le motif exigeait des caractères contigus.
  it("lit un livre numéroté, collé ou espacé", () => {
    expect(parseBibleRef("1Jao 3:16")).toMatchObject({ bookAlias: "1Jao", chapter: "3" });
    expect(parseBibleRef("1 Jaona 3:16")).toMatchObject({ chapter: "3", verseStart: "16" });
    expect(normalizeBookName(parseBibleRef("1 Jaona 3:16")!.bookAlias)).toBe("1jaona");
  });

  it("tolère un point après l'abréviation", () => {
    // Le point est consommé comme séparateur, pas gardé dans le nom : les
    // deux formes doivent donc donner le même alias.
    expect(parseBibleRef("Jao. 3:16")).toMatchObject({ bookAlias: "Jao", chapter: "3" });
    expect(parseBibleRef("Jao 3:16")).toMatchObject({ bookAlias: "Jao", chapter: "3" });
  });

  it("refuse ce qui n'est pas une référence", () => {
    // En mode Texte, l'opérateur tape des mots : on ne doit pas sauter de
    // chapitre en chapitre à chaque lettre.
    expect(parseBibleRef("")).toBeNull();
    expect(parseBibleRef("amour de Dieu")).toBeNull();
    expect(parseBibleRef("Jaona")).toBeNull();
  });
});

describe("resolveBook", () => {
  it("retrouve un livre par son nom complet", () => {
    expect(resolveBook("Jaona", BOOKS, abbrOf)).toBe("Jaona");
    expect(resolveBook("genesisy", BOOKS, abbrOf)).toBe("Genesisy");
  });

  it("retrouve un livre par un préfixe de son nom", () => {
    expect(resolveBook("Gene", BOOKS, abbrOf)).toBe("Genesisy");
  });

  it("retrouve un livre par son abréviation", () => {
    expect(resolveBook("Gen.", BOOKS, abbrOf)).toBe("Genesisy");
    expect(resolveBook("Asa", BOOKS, abbrOf)).toBe("Asan'ny Apostoly");
  });

  // Les deux sens de comparaison, chacun couvrant la moitié des cas.
  it("fait correspondre la saisie et l'abrégé dans les deux sens", () => {
    expect(resolveBook("1jao", BOOKS, abbrOf)).toBe("1 Jaona");
    expect(resolveBook("1jaona", BOOKS, abbrOf)).toBe("1 Jaona");
  });

  it("ne confond pas « Jaona » et « 1 Jaona »", () => {
    expect(resolveBook("Jao", BOOKS, abbrOf)).toBe("Jaona");
    expect(resolveBook("2jao", BOOKS, abbrOf)).toBe("2 Jaona");
  });

  it("ignore un livre dont l'abréviation est absente", () => {
    // `abbrOf` renvoie souvent `undefined` : un abrégé vide ne doit pas
    // correspondre à tout.
    expect(resolveBook("zzz", BOOKS, () => undefined)).toBeNull();
  });

  it("renvoie null plutôt que de deviner", () => {
    expect(resolveBook("Coran", BOOKS, abbrOf)).toBeNull();
    expect(resolveBook("", BOOKS, abbrOf)).toBeNull();
  });
});

describe("chaîne complète, telle que la frappe l'opérateur", () => {
  const cases: [string, string, string][] = [
    ["Jao 3:16", "Jaona", "3"],
    ["1jao 5:4", "1 Jaona", "5"],
    ["1 Jaona 5:4", "1 Jaona", "5"],
    ["sal 23", "Salamo", "23"],
    ["Gen. 1:1", "Genesisy", "1"],
    ["asa 2:38", "Asan'ny Apostoly", "2"],
  ];

  it.each(cases)("« %s » → %s %s", (query, book, chapter) => {
    const ref = parseBibleRef(query);
    expect(ref).not.toBeNull();
    expect(resolveBook(ref!.bookAlias, BOOKS, abbrOf)).toBe(book);
    expect(ref!.chapter).toBe(chapter);
  });
});
