import { describe, expect, it } from "vitest";
import {
  hasSource, isBibleChapter, isFromDatabase, isPdf, isTextual, itemType,
  newItemId, sourceOf, textOf, type ItemType, type PlaylistItem,
} from "./items";

const hymn: PlaylistItem = {
  id: "1", title: "Akory", number: "42", lyrics: "Strophe",
  type: "hymnes", book: "sda-hymnal",
};
const chapter: PlaylistItem = {
  id: "2", title: "Genesisy 1", number: "1", lyrics: "Verset", type: "bible",
  book: "Genesisy", book_index: 1, version: "mg65",
};
const media = (type: "image" | "video" | "audio" | "document", path: string): PlaylistItem =>
  ({ id: "3", title: "M", type, lyrics: path });

/** Les neuf natures réellement produites par l'application. */
const ALL_TYPES: ItemType[] = [
  "hymnes", "bible", "custom", "text", "markdown",
  "image", "video", "audio", "document", "youtube", "link",
];

describe("itemType", () => {
  it("rend le type déclaré", () => {
    expect(itemType(hymn)).toBe("hymnes");
    expect(itemType(chapter)).toBe("bible");
    expect(itemType({ type: "markdown" })).toBe("markdown");
  });

  /**
   * Un agenda enregistré par une version ancienne ne porte pas de `type` :
   * c'était forcément un cantique.
   */
  it("retombe sur « hymnes » quand le type manque", () => {
    expect(itemType({})).toBe("hymnes");
    expect(itemType(null)).toBe("hymnes");
    expect(itemType(undefined)).toBe("hymnes");
  });
});

describe("partition texte / source", () => {
  /**
   * Garde-fou central : chaque nature doit tomber dans EXACTEMENT un des deux
   * camps. Une nature ajoutée sans être classée serait traitée comme un média,
   * donc invisible — ce qui se voit immédiatement — au lieu de faire projeter
   * un chemin de fichier devant l'assemblée.
   */
  it.each(ALL_TYPES)("« %s » est soit du texte, soit une source", (type) => {
    const item = { type } as any;
    expect(isTextual(item) !== hasSource(item)).toBe(true);
  });

  it.each([
    ["hymnes", false], ["bible", false], ["custom", false], ["text", false],
    ["markdown", false], ["image", true], ["video", true], ["audio", true],
    ["document", true], ["youtube", true], ["link", true],
  ] as const)("hasSource(%s) = %s", (type, expected) => {
    expect(hasSource({ type })).toBe(expected);
  });
});

describe("textOf / sourceOf — les deux sens de `lyrics`", () => {
  it("rend le texte d'un cantique et d'un chapitre", () => {
    expect(textOf(hymn)).toBe("Strophe");
    expect(textOf(chapter)).toBe("Verset");
    expect(sourceOf(hymn)).toBeNull();
  });

  it("rend le texte d'un markdown, d'un texte et d'un programme libre", () => {
    expect(textOf({ id: "4", title: "T", type: "markdown", lyrics: "# Titre" })).toBe("# Titre");
    expect(textOf({ id: "5", title: "T", type: "text", lyrics: "Méditation" })).toBe("Méditation");
    expect(textOf({ id: "6", title: "T", type: "custom", lyrics: "Programme" })).toBe("Programme");
  });

  /**
   * Le garde-fou qui compte : projeter `/home/.../video.mp4` en lettres
   * géantes devant l'assemblée doit être impossible, pas seulement improbable.
   */
  it("refuse de rendre un chemin de fichier comme du texte", () => {
    for (const type of ["image", "video", "audio", "document"] as const) {
      const item = media(type, "/home/bryan/video.mp4");
      expect(textOf(item)).toBeNull();
      expect(sourceOf(item)).toBe("/home/bryan/video.mp4");
    }
  });

  it("traite un identifiant YouTube et une URL comme des sources", () => {
    const yt: PlaylistItem = { id: "7", title: "Y", type: "youtube", lyrics: "dQw4w9WgXcQ" };
    expect(sourceOf(yt)).toBe("dQw4w9WgXcQ");
    expect(textOf(yt)).toBeNull();

    const link: PlaylistItem = { id: "8", title: "L", type: "link", lyrics: "https://exemple.org" };
    expect(sourceOf(link)).toBe("https://exemple.org");
    expect(textOf(link)).toBeNull();
  });

  it("tolère un élément absent", () => {
    expect(textOf(null)).toBeNull();
    expect(sourceOf(undefined)).toBeNull();
  });

  it("rend une chaîne vide plutôt que undefined", () => {
    expect(textOf({ id: "9", title: "T", type: "text" } as any)).toBe("");
    expect(sourceOf({ id: "9", title: "T", type: "video" } as any)).toBe("");
  });
});

describe("isFromDatabase", () => {
  /**
   * ⚠ C'est la provenance qui compte, pas le type : tester une liste de types
   * faisait que chaque nature ajoutée ensuite tentait d'écrire dans
   * « undefined.SQLite3 ».
   */
  it("reconnaît ce qui vient d'une base", () => {
    expect(isFromDatabase(hymn)).toBe(true);
    expect(isFromDatabase(chapter)).toBe(true);
  });

  it.each(["custom", "text", "markdown", "image", "video", "audio", "document", "youtube", "link"] as const)(
    "dit non pour un élément d'agenda « %s »",
    (type) => {
      expect(isFromDatabase({ id: "x", title: "T", type, lyrics: "v" } as any)).toBe(false);
    }
  );

  it("ignore un nom de base vide", () => {
    expect(isFromDatabase({ id: "x", title: "T", lyrics: "v", book: "   " } as any)).toBe(false);
  });
});

describe("isBibleChapter", () => {
  it("distingue un chapitre d'un cantique", () => {
    expect(isBibleChapter(chapter)).toBe(true);
    expect(isBibleChapter(hymn)).toBe(false);
  });

  it("reconnaît un agenda ancien, qui n'a que la version", () => {
    expect(isBibleChapter({ id: "x", title: "T", lyrics: "v", version: "mg65" } as any)).toBe(true);
  });

  it("ne confond pas avec un média", () => {
    expect(isBibleChapter(media("video", "/x.mp4"))).toBe(false);
    expect(isBibleChapter(null)).toBe(false);
  });
});

describe("isPdf", () => {
  it("reconnaît un PDF, qui se projette page par page", () => {
    expect(isPdf(media("document", "/docs/livre.pdf"))).toBe(true);
    expect(isPdf(media("document", "/docs/livre.PDF?v=2"))).toBe(true);
  });

  it("ne confond pas avec un autre document", () => {
    expect(isPdf(media("document", "/docs/notes.txt"))).toBe(false);
    expect(isPdf(media("video", "/x.pdf.mp4"))).toBe(false);
    expect(isPdf(hymn)).toBe(false);
  });
});

describe("newItemId", () => {
  /**
   * ⚠ La régression que ce test empêche : les sites de création utilisaient
   * `Date.now()` seul. Ajouter plusieurs éléments dans la même milliseconde —
   * un ajout en lot, la génération d'un culte — produisait des identifiants
   * identiques, donc des `key` React dupliquées, donc une diapo qui en
   * remplace une autre à l'écran.
   */
  it("reste unique même sur des appels dans la même milliseconde", () => {
    const ids = Array.from({ length: 500 }, () => newItemId());
    expect(new Set(ids).size).toBe(500);
  });

  it("produit une chaîne non vide", () => {
    expect(newItemId()).toMatch(/^\d+-[0-9a-z]+$/);
  });
});
