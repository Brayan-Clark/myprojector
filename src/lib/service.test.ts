import { describe, expect, it } from "vitest";
import {
  SERVICE_VERSION, buildService, defaultServiceFileName,
  defaultServiceTitle, parseService, serializeService,
} from "./service";
import type { PlaylistItem } from "./items";

const items: PlaylistItem[] = [
  { id: "a", title: "Cantique 42", number: "42", type: "hymnes", lyrics: "Strophe" },
  { id: "b", title: "Lecture", type: "text", lyrics: "Jean 3:16" },
];

describe("aller-retour", () => {
  it("conserve les éléments et les métadonnées", () => {
    const doc = buildService(items, { title: "Culte test", notes: "Prédicateur : X" });
    const { document, origin, dropped } = parseService(serializeService(doc));
    expect(origin).toBe("current");
    expect(dropped).toBe(0);
    expect(document.title).toBe("Culte test");
    expect(document.notes).toBe("Prédicateur : X");
    expect(document.items).toEqual(items);
  });

  it("marque le format pour pouvoir refuser un fichier étranger", () => {
    const doc = buildService(items);
    expect(doc.kind).toBe("myprojector.service");
    expect(doc.version).toBe(SERVICE_VERSION);
  });

  it("donne un titre et un nom de fichier par défaut utilisables", () => {
    const d = new Date("2026-11-01T10:00:00");
    expect(defaultServiceFileName(d)).toBe("culte-2026-11-01.json");
    expect(defaultServiceTitle(d)).toContain("2026");
  });

  it("écrit un fichier lisible à l'œil", () => {
    // Un opérateur doit pouvoir l'ouvrir dans un éditeur de texte et, au
    // besoin, le réparer à la main.
    expect(serializeService(buildService(items))).toContain("\n  ");
  });
});

describe("lecture de l'ancien format", () => {
  /**
   * Les versions antérieures écrivaient `JSON.stringify(playlist)`, un tableau
   * nu. Ces fichiers existent sur les postes : les refuser reviendrait à
   * perdre les cultes déjà préparés.
   */
  it("lit un tableau nu et le signale", () => {
    const { document, origin } = parseService(JSON.stringify(items));
    expect(origin).toBe("legacy");
    expect(document.items).toEqual(items);
    expect(document.version).toBe(SERVICE_VERSION);
    expect(document.title).toBeTruthy();
  });

  it("accepte un objet sans marqueur mais avec des éléments", () => {
    const { origin, document } = parseService(JSON.stringify({ items }));
    expect(origin).toBe("current");
    expect(document.items).toHaveLength(2);
  });
});

describe("robustesse", () => {
  it("dit pourquoi un fichier est illisible, au lieu de ne rien faire", () => {
    // L'ancien code faisait `catch { console.error }` : l'opérateur cliquait
    // « ouvrir » et rien ne se passait, sans console accessible.
    expect(() => parseService("{ pas du json")).toThrow(/JSON invalide/);
    expect(() => parseService('{"autre":"chose"}')).toThrow(/ne contient pas d'agenda/);
    expect(() => parseService('"texte"')).toThrow(/ne contient pas d'agenda/);
    expect(() => parseService("[]")).toThrow(/aucun élément/);
  });

  /**
   * Lire à moitié un format inconnu ferait perdre des éléments en silence, et
   * l'enregistrement suivant les effacerait pour de bon.
   */
  it("refuse une version plus récente, en expliquant", () => {
    const future = JSON.stringify({
      kind: "myprojector.service", version: SERVICE_VERSION + 1, items,
    });
    expect(() => parseService(future)).toThrow(/version plus récente/);
  });

  it("accepte une version plus ancienne", () => {
    const old = JSON.stringify({ kind: "myprojector.service", version: 1, items });
    expect(parseService(old).document.items).toHaveLength(2);
  });

  it("écarte les éléments inutilisables sans perdre le reste", () => {
    const mixed = JSON.stringify([
      items[0],
      null,
      { title: "sans paroles" },
      { lyrics: "sans titre" },
      "texte",
      items[1],
    ]);
    const { document, dropped } = parseService(mixed);
    expect(document.items.map((i) => i.title)).toEqual(["Cantique 42", "Lecture"]);
    expect(dropped).toBe(4);
  });

  it("répare un identifiant manquant plutôt que de jeter l'élément", () => {
    const { document, dropped } = parseService(
      JSON.stringify([{ title: "Sans id", lyrics: "Texte" }])
    );
    expect(dropped).toBe(0);
    expect(document.items[0].id).toBeTruthy();
  });

  /**
   * Les anciens `Date.now()` produisaient des identifiants identiques sur un
   * ajout en lot : deux `key` React égales, donc une diapo qui en remplace une
   * autre à l'écran. On les sépare à la lecture.
   */
  it("dédoublonne les identifiants", () => {
    const { document } = parseService(JSON.stringify([
      { id: "même", title: "A", lyrics: "a" },
      { id: "même", title: "B", lyrics: "b" },
    ]));
    expect(document.items).toHaveLength(2);
    expect(document.items[0].id).not.toBe(document.items[1].id);
  });

  it("remplace un titre vide par un titre par défaut", () => {
    const { document } = parseService(JSON.stringify({
      kind: "myprojector.service", version: 1, title: "   ", items,
    }));
    expect(document.title).toBeTruthy();
    expect(document.title.trim()).not.toBe("");
  });
});
