# La bibliothèque et les contenus distants

Tout ce qui se télécharge dans l'application vient d'un **second dépôt** :

```
https://github.com/Brayan-Clark/adventools   branche : data
```

Base des URL, dans `src/lib/library.ts` :

```ts
export const DATA_BASE = "https://raw.githubusercontent.com/Brayan-Clark/adventools/data";
```

**Principe non négociable : tout est optionnel.** L'application fonctionne
entièrement sans rien télécharger, et l'utilisateur peut tout retirer.

---

## Les catalogues

| Contenu | Fichier distant | Cache local |
|---|---|---|
| Documents | `docs/manifest.json` | `docs-manifest` |
| Recueils audio | `audio/playbacks/manifest.json` | `audio-collections` |
| Pistes d'un recueil | `audio/playbacks/<id>.json` | `audio-tracks-<id>` |
| Mofon'aina | `mofonaina/manifest.json` | `mofonaina-manifest` |
| Mofon'aina (repli) | API GitHub (liste du dossier) | `mofonaina-index` |

L'École du Sabbat ne vient **pas** de ce dépôt : voir sa section plus bas.

### Format `mofonaina/manifest.json`

```json
{ "version": 1, "updatedAt": "2026-09-28",
  "quarters": [{
    "id": "2026-Q4", "annee": 2026, "trimestre": 4,
    "titre": "NY FANJAKAN'NY LANITRA", "file": "2026-Q4.json",
    "url": "…/mofonaina/2026-Q4.json",
    "startDate": "2026-09-27", "endDate": "2026-12-26",
    "count": 91, "size": "237 KB", "version": 1 }] }
```

Le manifeste n'est **pas obligatoire** : les trimestres publiés avant son
existence ne sont connus que par la liste de fichiers, et la section affiche
l'union du manifeste, du catalogue et de ce qui est sur le disque.

⚠ **`startDate` ne suit pas le calendrier.** Le trimestre 4 de 2026 commence le
27 septembre : deviner le fichier d'après le mois courant donnerait le mauvais
livret pendant une semaine.

### Extras du livret Mofon'aina

Depuis le trimestre 4 de 2026, chaque méditation peut porter `source`,
`jour_semaine`, `psaume_du_jour`, `lecture_du_jour`, `coucher_du_soleil`, et le
fichier porte un dictionnaire `abbreviations`.

Tous sont **optionnels et intermittents** : le livret publie la lecture du livre
le dimanche, le coucher du soleil le vendredi et le sabbat. Chaque ligne est
donc affichée conditionnellement.

⚠ `psaume_du_jour` **ne contient pas que des psaumes** : c'est le plan de
lecture biblique de l'année, « Diabe » dans le livret. L'étiqueter « psaume du
jour » dans l'interface reprendrait à son compte une erreur du nom de champ.
Les noms employés par le livret sont **Diabe**, **Velomin'ny teniny** et
**Filentehan'ny masoandro**.

`jour_semaine` prime sur le jour calculé par `Intl` : c'est la graphie que
l'assemblée a sous les yeux, et elle ne dépend d'aucune locale installée.

### Format `docs/manifest.json`

```json
{
  "departments": [{ "id": "jeunesse", "translations": { "fr": "Jeunesse" } }],
  "categories":  [{ "id": "egw", "title": "Esprit de Prophétie", "color": "#5865f2" }],
  "documents":   [{ "id": "men_001", "title": "…", "fileName": "…",
                    "categoryId": "egw", "url": "https://…", "size": "2.4 MB",
                    "tags": ["Tous"] }]
}
```

**⚠ Le champ `size` n'est pas fiable.** 17 entrées sur 178 annoncent une taille
fausse, avec des confusions d'unité spectaculaires : *Education* est annoncé à
801,4 MB pour un fichier de 0,8 Mo ; *ANY AMPARANY ANY* à 3,7 KB pour 3,5 Mo.
Additionner ces valeurs donnait 2,96 Go au lieu des ~700 Mo réels. L'application
**n'affiche donc aucune estimation** avant téléchargement, et montre le volume
réel au fur et à mesure. Pour rétablir une estimation, il faut d'abord corriger
les tailles dans le dépôt de données.

### Format d'un recueil audio

```json
[{ "id": "300", "c_num": "324", "title": "Ry Jeso ô", "url": "https://…" }]
```

**⚠ Le lien avec un cantique se fait par `c_num`, pas par `id`.** Dans
`fihirana-adventista`, l'entrée `id: 300` correspond au cantique n° 324. Le
fichier local est nommé `<c_num>.mp3`, ce qui permet de retrouver l'audio d'un
chant **sans le catalogue distant** — donc hors ligne.

Côté base des recueils, la colonne `c_playbacks` de la table
`adventiste_cantique` porte l'identifiant du recueil audio. Elle n'existe pas
dans tous les fichiers : `fetch_hymns` vérifie sa présence avant de la lire.

---

## Le mode hors ligne

Chaque catalogue reçu est écrit dans `data/_manifests/`. Si la requête échoue,
l'application repart de cette copie et affiche un bandeau **Mode hors ligne**
discret, au lieu de tout masquer.

En plus du cache, le Mofon'aina liste l'**union** du catalogue et du disque : un
trimestre téléchargé reste ouvrable même sans cache et sans réseau.

**⚠ L'API GitHub est limitée à 60 appels par heure et par adresse IP** sans
authentification. Passé ce quota elle répond `403`, ce qui ressemble à une
absence de connexion alors que tout va bien. Le message d'erreur le dit
maintenant explicitement. C'est la seule requête qui passe par l'API ; tout le
reste utilise `raw.githubusercontent.com`, sans quota comparable.

---

## Téléchargements

Commande Rust `download_library_file`, ou `download_batch` pour un lot (audio et
documents partagent le même moteur).

- écriture au fil de l'eau dans un fichier `.part`, renommé une fois complet :
  une coupure ne laisse jamais un fichier tronqué qui passerait pour valide ;
- progression émise vers l'interface (`library_download_progress`,
  `batch_download_progress`) ;
- un lot est séquentiel, tolérant aux échecs et interruptible ; ce qui est déjà
  reçu est conservé ;
- un téléchargement groupé suit **exactement les filtres affichés** : on ne
  déclenche jamais plus que ce que l'utilisateur a sous les yeux.

### Liste blanche d'hôtes

`host_allowed(kind, host)` dans `lib.rs`. Les documents et le Mofon'aina ne
viennent que de GitHub ; les audios sont hébergés ailleurs (sdahymnals, Google
Drive, fanantenanahoanao, nybaiboly). Cette liste est explicite pour que la
commande ne devienne pas un téléchargeur d'URL arbitraire pilotable depuis la
page. **Ajouter un hôte demande une modification de code volontaire.**

---

## École du Sabbat

`src/lib/sabbathSchool.ts` — **seul contenu qui ne vient pas de la branche
`data`.** Les leçons sont publiées par l'amont adventiste et doivent apparaître
sans qu'on livre une nouvelle version de MyProjector.

| Donnée | Point d'entrée |
|---|---|
| Langues (95) | `sabbath-school.adventech.io/api/v2/languages/index.json` |
| Classes + trimestres | `<hôte>/api/v3/<langue>/ss/index.json` → `groups[]` |
| Leçons d'un trimestre | `<hôte>/api/v3/<index>/sections/index.json` |
| Contenu d'une leçon | `<hôte>/api/v3/<index>/<NN>/index.json` → `segments[]` |

`<hôte>` vaut `inverse.sspmadventist.org` ou `absg.sspmadventist.org`. **Les
deux servent la même charge utile** : le second n'est qu'un repli. `inverse`
porte historiquement le malgache et les classes `-cq`, d'où l'ordre choisi par
`hostsFor`.

⚠ **Ce sont les leçons que porte `sections/index.json`, pas l'`index.json` du
trimestre** — celui-ci ne contient que la présentation. Une requête suffit donc
pour obtenir les vrais titres et les vraies dates, là où deviner « 01 » à « 13 »
obligerait à treize requêtes pour n'obtenir que des numéros.

⚠ **Ni les langues ni les classes ne sont codées en dur.** Les classes diffèrent
d'une langue à l'autre (« Lesona Lehibe » en malgache, « InVerse » en français,
douze classes en anglais) et l'amont en ajoute : les figer afficherait des
filtres qui ne correspondent à rien. Seuls les **endonymes** et les **drapeaux**
sont des tables locales, et la table des drapeaux reste courte à dessein — la
plupart des 95 langues ne correspondent pas à un pays.

Les dates arrivent au format `jj/mm/aaaa` (`isoDate` les convertit).

### Conversion en diapos

`blocksToMarkdown` traduit les blocs de l'API en Markdown découpé par `---`,
que l'agenda sait déjà séparer (`lib/slides.ts`, type `markdown`). Les choix qui
comptent :

- un `heading` n'occupe **pas** sa propre diapo : il préfixe la suivante, sinon
  l'assemblée voit un écran de titre puis un écran de contenu ;
- un `blockquote` tient sur **une** diapo — le verset à mémoriser se présente
  comme un intitulé suivi du texte, et les séparer donnait une diapo ne
  contenant que « Verset à mémoriser : » ;
- les références sont écrites comme des liens vers des schémas internes à
  l'application mobile (`sspmBible://`, `sspmEGW://`). `cleanInline` garde le
  libellé et jette la cible, qui ne mène nulle part ici ;
- l'amont écrit `list-item`, pas `listItem` ;
- images, vidéos et blocs `reference` sont ignorés : rien à projeter comme texte.

Le cache de repli vit dans `localStorage` (`ss:*`), plafonné à 400 Ko par
entrée : hors ligne, on relit ce qui a déjà été consulté.

Les hôtes ci-dessus sont ajoutés à `connect-src` **et** `img-src` dans la CSP
(les couvertures de trimestre sont des images distantes).

---

## L'audio de la Bible

`src/data/bible-audio-map.json` — 1189 entrées, **embarqué dans l'application**
(ces données ne changent pas, aucun réseau nécessaire pour connaître l'URL d'un
chapitre).

Clé : `<rang du livre × 10>-<chapitre>`, par exemple `10-1` pour Genèse 1.

**⚠ Le rang n'est pas `books.book_number`.** La numérotation MyBible va de 10 à
730 avec des trous réservés aux deutérocanoniques ; la carte audio, elle, est
continue. C'est le **rang** (1 = Genèse … 66 = Apocalypse) multiplié par 10 qui
indexe la carte. Les 66 livres ont été vérifiés un par un.

Trois entrées du fichier source pointaient vers le chapitre précédent
(Ohabolana 8, Hosea 5, Hebreo 3). Elles sont corrigées dans la copie embarquée ;
**si tu régénères ce fichier depuis la source d'origine, les erreurs
reviendront.**

L'audio n'est proposé que pour les versions malgaches MG65 / MG1965 : c'est le
texte qui correspond à l'enregistrement.

---

## Recherche biblique

`LeftSidebar.tsx`. Les références acceptées vont de `Jean 3:16` à `1Jao.3.16`.

**⚠ `long_name` contient une espace après le chiffre** : le premier livre de
Jean s'écrit `"1 Jaona"`. Un `startsWith("1jao")` échoue donc — c'était la cause
de l'échec des recherches sur les livres commençant par un chiffre. La
résolution utilise maintenant `books.short_name` (exposé par la commande Rust
sous le champ `abbr`), une normalisation Unicode (NFD, accents retirés) et une
expression régulière tolérante aux séparateurs `.`, `:` et espace.
