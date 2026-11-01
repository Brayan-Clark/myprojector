import { describe, expect, it } from "vitest";
import {
  assembleSabbathPlan, describeSabbath, localIso, nextSabbath, pickQuarterly,
} from "./sabbathPlan";
import { textOf } from "./items";
import { BUILTIN_TEMPLATES } from "./serviceTemplates";

const SABBATH_STEPS = BUILTIN_TEMPLATES.find((t) => t.id === "sabbath-long")!.steps.length;

describe("nextSabbath", () => {
  /**
   * Le samedi, l'opérateur prépare le culte DU JOUR — pas celui de la semaine
   * suivante. Le reste de la semaine, celui qui vient.
   */
  it("rend le jour même quand on est samedi", () => {
    const samedi = new Date(2026, 10, 7); // 7 novembre 2026, un samedi
    expect(samedi.getDay()).toBe(6);
    expect(localIso(nextSabbath(samedi))).toBe("2026-11-07");
  });

  it("rend le samedi suivant les autres jours", () => {
    // Dimanche 1er novembre 2026 → samedi 7.
    expect(localIso(nextSabbath(new Date(2026, 10, 1)))).toBe("2026-11-07");
    // Vendredi 6 → samedi 7.
    expect(localIso(nextSabbath(new Date(2026, 10, 6)))).toBe("2026-11-07");
  });

  it("franchit un changement de mois", () => {
    // Lundi 26 octobre 2026 → samedi 31 octobre.
    expect(localIso(nextSabbath(new Date(2026, 9, 26)))).toBe("2026-10-31");
    // Mercredi 30 décembre 2026 → samedi 2 janvier 2027.
    expect(localIso(nextSabbath(new Date(2026, 11, 30)))).toBe("2027-01-02");
  });

  it("ignore l'heure de la journée", () => {
    const tard = new Date(2026, 10, 6, 23, 45);
    expect(localIso(nextSabbath(tard))).toBe("2026-11-07");
  });
});

describe("localIso", () => {
  /**
   * ⚠ Jamais `toISOString()` : il est en UTC, et à Madagascar (UTC+3) il
   * désigne encore la veille jusqu'à 3 h du matin — on préparerait le mauvais
   * jour.
   */
  it("reste sur la date locale, même tôt le matin", () => {
    expect(localIso(new Date(2026, 10, 7, 1, 30))).toBe("2026-11-07");
    expect(localIso(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  it("complète les mois et jours sur deux chiffres", () => {
    expect(localIso(new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});

describe("assembleSabbathPlan", () => {
  const lesson = { title: "01 · Le Créateur parle", markdown: "Diapo", subtitle: "Adultes" };
  const meditation = { title: "Mahereza", lyrics: "Verset\n(Kôl. 3:1)" };

  it("place le contenu trouvé avant le déroulé", () => {
    // À l'ouverture de l'agenda, l'opérateur doit voir ce que la génération a
    // trouvé, pas neuf repères vides qu'il faut faire défiler.
    const plan = assembleSabbathPlan("2026-11-07", { lesson, meditation });
    expect(plan.items[0].title).toBe(lesson.title);
    expect(plan.items[1].title).toBe(meditation.title);
    expect(plan.items).toHaveLength(2 + SABBATH_STEPS);
  });

  it("donne au contenu une nature projetable", () => {
    const plan = assembleSabbathPlan("2026-11-07", { lesson, meditation });
    expect(plan.items[0].type).toBe("markdown");
    expect(plan.items[1].type).toBe("text");
    // Et surtout : le contenu est bien du TEXTE, pas une source de média.
    expect(textOf(plan.items[0])).toBe("Diapo");
    expect(textOf(plan.items[1])).toContain("Verset");
  });

  it("produit des identifiants tous distincts", () => {
    // Les onze éléments sont créés dans la même milliseconde : c'est le cas
    // exact où `Date.now()` donnait des clés React dupliquées.
    const plan = assembleSabbathPlan("2026-11-07", { lesson, meditation });
    expect(new Set(plan.items.map((i) => i.id)).size).toBe(plan.items.length);
  });

  /**
   * ⚠ Le point qui compte : un morceau manquant doit être ANNONCÉ. Livrer un
   * culte à trous que l'opérateur découvre devant l'assemblée serait pire que
   * de ne rien générer.
   */
  it("signale la leçon manquante", () => {
    const plan = assembleSabbathPlan("2026-11-07", { meditation });
    expect(plan.missing.join(" ")).toMatch(/École du Sabbat/);
    expect(plan.included.join(" ")).toMatch(/Mofon'aina/);
    expect(plan.items).toHaveLength(1 + SABBATH_STEPS);
  });

  it("signale la méditation manquante", () => {
    const plan = assembleSabbathPlan("2026-11-07", { lesson });
    expect(plan.missing.join(" ")).toMatch(/Mofon'aina/);
    expect(plan.included.join(" ")).toMatch(/École du Sabbat/);
  });

  it("livre quand même le déroulé quand tout manque", () => {
    const plan = assembleSabbathPlan("2026-11-07", {});
    expect(plan.missing).toHaveLength(2);
    expect(plan.items).toHaveLength(SABBATH_STEPS);
    expect(plan.included.join(" ")).toMatch(/Déroulé/);
  });

  it("conserve la date visée", () => {
    expect(assembleSabbathPlan("2026-11-07", {}).date).toBe("2026-11-07");
  });

  it("nomme la classe retenue dans le compte rendu", () => {
    // L'automatisme choisit une classe : l'opérateur doit voir laquelle.
    const plan = assembleSabbathPlan("2026-11-07", { lesson });
    expect(plan.included.join(" ")).toContain("Adultes");
  });
});

describe("pickQuarterly", () => {
  /** Dates du livret, au format `jj/mm/aaaa`, encadrant aujourd'hui. */
  const p = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  const start = fmt(new Date(Date.now() - 7 * 86400000));
  const end = fmt(new Date(Date.now() + 7 * 86400000));
  const past = { startDate: "01/01/2020", endDate: "31/03/2020" };

  /**
   * ⚠ La régression vérifiée contre l'API : en malgache, « Lesona Lehibe »
   * publie la leçon principale ET son livre compagnon « Boky Mivelatra »
   * (suffixe `-cc`) sur la même semaine. Prendre le premier de la liste
   * donnait le compagnon.
   */
  it("préfère la leçon principale au livre compagnon", () => {
    const chosen = pickQuarterly([
      { index: "mg/ss/2026-04-cc", startDate: start, endDate: end },
      { index: "mg/ss/2026-04", startDate: start, endDate: end },
    ], "mg");
    expect(chosen!.index).toBe("mg/ss/2026-04");
  });

  it.each(["-cc", "-cq", "-pb", "-pth"])("écarte la variante « %s »", (suffix) => {
    const chosen = pickQuarterly([
      { index: `fr/ss/2026-04${suffix}`, startDate: start, endDate: end },
      { index: "fr/ss/2026-04", startDate: start, endDate: end },
    ], "fr");
    expect(chosen!.index).toBe("fr/ss/2026-04");
  });

  it("ne retient que les trimestres en cours quand il y en a", () => {
    const chosen = pickQuarterly([
      { index: "fr/ss/2020-01", ...past },
      { index: "fr/ss/2026-04", startDate: start, endDate: end },
    ], "fr");
    expect(chosen!.index).toBe("fr/ss/2026-04");
  });

  it("retombe sur le premier publié quand aucun n'est en cours", () => {
    // Entre deux trimestres (fin décembre), mieux vaut proposer quelque chose
    // que rien.
    const chosen = pickQuarterly([
      { index: "fr/ss/2026-04-cc", ...past },
      { index: "fr/ss/2026-04", ...past },
    ], "fr");
    expect(chosen!.index).toBe("fr/ss/2026-04");
  });

  it("accepte une variante s'il n'y a que ça", () => {
    const chosen = pickQuarterly([
      { index: "mg/ss/2026-04-cq", startDate: start, endDate: end },
    ], "mg");
    expect(chosen!.index).toBe("mg/ss/2026-04-cq");
  });

  it("ne confond pas les langues", () => {
    // Le motif est ancré sur la langue demandée : un index d'une autre langue
    // ne doit pas passer pour la leçon principale.
    const chosen = pickQuarterly([
      { index: "en/ss/2026-04", startDate: start, endDate: end },
      { index: "mg/ss/2026-04-cc", startDate: start, endDate: end },
    ], "mg");
    expect(chosen!.index).toBe("en/ss/2026-04");
  });

  it("rend undefined sur une liste vide", () => {
    expect(pickQuarterly([], "fr")).toBeUndefined();
  });
});

describe("describeSabbath", () => {
  it("rend une date lisible", () => {
    const label = describeSabbath("2026-11-07");
    expect(label).toContain("7");
    expect(label).toContain("novembre");
  });
});
