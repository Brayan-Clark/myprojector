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
| Mofon'aina | API GitHub (liste du dossier) | `mofonaina-index` |

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
