import { describe, expect, it } from "vitest";
import bibleAudioMap from "../data/bible-audio-map.json";
import { BIBLE_AUDIO_ENTRIES, trackForSong } from "./audioTrack";

const map = bibleAudioMap as Record<string, string>;

/**
 * Nombre de chapitres de chaque livre, dans l'ordre canonique.
 *
 * C'est la seule référence qui permette de vérifier la carte audio sans la
 * croire sur parole : 1189 chapitres, et la clé de chaque chapitre est
 * déterminée par le RANG du livre, pas par sa numérotation MyBible.
 *
 * ⚠ Deux livres ne suivent PAS la découpe des bibles anglaises protestantes,
 * parce que la bible malgache suit la découpe hébraïque :
 *
 *   - Joël (rang 29) a **4** chapitres, pas 3 ;
 *   - Malachie (rang 39) a **3** chapitres, pas 4.
 *
 * Le total retombe sur 1189 dans les deux cas, donc un simple comptage ne
 * révèle rien : c'est en comparant livre par livre qu'on le voit. Quiconque
 * régénère la carte depuis une source anglaise décalera ces deux livres.
 */
const CHAPTERS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150,
  31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16,
  24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1,
  1, 22,
];
// Rang (1-indexé) → nombre de chapitres réel dans la découpe malgache.
const HEBREW_DIVISION: Record<number, number> = { 29: 4, 39: 3 };
CHAPTERS.forEach((_, i) => {
  const fix = HEBREW_DIVISION[i + 1];
  if (fix !== undefined) CHAPTERS[i] = fix;
});

describe("carte audio de la Bible", () => {
  it("couvre les 1189 chapitres", () => {
    expect(CHAPTERS.reduce((a, b) => a + b, 0)).toBe(1189);
    expect(BIBLE_AUDIO_ENTRIES).toBe(1189);
    expect(Object.keys(map)).toHaveLength(1189);
  });

  /**
   * ⚠ Le rang n'est PAS `books.book_number`.
   *
   * La numérotation MyBible va de 10 à 730 avec des trous réservés aux
   * deutérocanoniques ; la carte audio, elle, est continue. C'est le rang
   * (1 = Genèse … 66 = Apocalypse) multiplié par 10 qui l'indexe. Ce test
   * fixe cette convention : s'en écarter décalerait tous les livres après
   * Esther d'un cran, et on projetterait le mauvais chapitre.
   */
  it("indexe chaque livre par son rang × 10, sans trou", () => {
    const missing: string[] = [];
    CHAPTERS.forEach((count, i) => {
      const rank = i + 1;
      for (let chapter = 1; chapter <= count; chapter++) {
        const key = `${rank * 10}-${chapter}`;
        if (!map[key]) missing.push(key);
      }
    });
    expect(missing).toEqual([]);
  });

  it("n'a aucune clé en trop", () => {
    const expected = new Set<string>();
    CHAPTERS.forEach((count, i) => {
      for (let c = 1; c <= count; c++) expected.add(`${(i + 1) * 10}-${c}`);
    });
    expect(Object.keys(map).filter((k) => !expected.has(k))).toEqual([]);
  });

  it("ne contient que des URL exploitables", () => {
    const bad = Object.entries(map).filter(([, url]) => !/^https?:\/\/\S+$/.test(url));
    expect(bad).toEqual([]);
  });

  /**
   * Les trois entrées corrigées à la main.
   *
   * Le fichier d'origine faisait pointer ces chapitres vers le PRÉCÉDENT.
   * `docs/BIBLIOTHEQUE.md` prévient que « si tu régénères ce fichier depuis la
   * source d'origine, les erreurs reviendront » — ce test est là pour que la
   * régression soit bruyante au lieu d'être découverte pendant un culte.
   *
   * Le contrôle porte sur le numéro de chapitre lisible dans l'URL : il doit
   * correspondre à la clé, et non valoir un de moins.
   */
  it.each([
    ["Ohabolana 8", 200, 8],
    ["Hosea 5", 280, 5],
    ["Hebreo 3", 580, 3],
  ])("%s ne pointe pas vers le chapitre précédent", (_label, rankKey, chapter) => {
    const url = map[`${rankKey}-${chapter}`];
    expect(url).toBeTruthy();
    const digits = url.match(/(\d+)(?=\D*$)/);
    expect(digits).not.toBeNull();
    expect(Number(digits![1])).not.toBe(chapter - 1);
  });
});

describe("trackForSong", () => {
  it("ne renvoie rien pour un élément sans audio", () => {
    expect(trackForSong(null)).toBeNull();
    expect(trackForSong({ title: "Texte libre", type: "text" })).toBeNull();
  });

  it("résout un cantique par son numéro, sans réseau", () => {
    const track = trackForSong({ title: "Akory", number: 42, playback: "sda-hymnal" });
    expect(track).toMatchObject({
      collection: "sda-hymnal",
      filename: "42.mp3",
      // L'URL vit dans le manifeste distant du recueil : elle demande une
      // recherche, et ne doit donc PAS être devinée ici.
      directUrl: null,
      needsLookup: true,
      hymnNumber: "42",
    });
  });

  it("refuse un cantique sans numéro utilisable", () => {
    expect(trackForSong({ title: "Sans numéro", number: "  ", playback: "sda-hymnal" })).toBeNull();
  });

  it("résout un chapitre biblique malgache", () => {
    const track = trackForSong({
      book: "Genesisy", book_index: 1, number: "1", version: "mg65",
    });
    expect(track).toMatchObject({
      collection: "bible-mg",
      filename: "1-1.mp3",
      needsLookup: false,
    });
    expect(track!.directUrl).toBe(map["10-1"]);
  });

  /**
   * L'audio n'est proposé que pour les versions malgaches MG65 / MG1965 :
   * c'est le seul texte qui corresponde à l'enregistrement. Le proposer
   * ailleurs donnerait une lecture qui ne suit pas le texte projeté.
   */
  it.each([["mg65", true], ["mg1965", true], ["MG65", true], ["lsg", false], ["kjv", false], ["", false]])(
    "version « %s » → audio %s",
    (version, expected) => {
      const track = trackForSong({ book: "Genesisy", book_index: 1, number: "1", version });
      expect(track !== null).toBe(expected);
    }
  );

  it("ne renvoie rien pour un chapitre hors de la carte", () => {
    expect(trackForSong({ book: "Inconnu", book_index: 99, number: "1", version: "mg65" })).toBeNull();
  });
});
