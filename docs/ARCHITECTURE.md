# Architecture

Comment l'application est faite, et pourquoi. Les points marqués **⚠** sont des
pièges déjà rencontrés : ils ont l'air d'erreurs mais sont volontaires.

---

## 1. Les deux fenêtres

L'application ouvre **deux fenêtres qui exécutent le même code** :

| Fenêtre | URL | Rôle |
|---|---|---|
| Contrôle | `/` | Ce que voit l'opérateur |
| Projection | `/?live=true` | Ce que voit l'assemblée |

`App.tsx` lit ce paramètre au démarrage (`isLiveMode`) et rend `LiveView` au
lieu de l'interface complète. La fenêtre de projection est créée à la demande
par `handleLiveToggle()`, en plein écran sans décorations, positionnée sur le
dernier moniteur détecté.

Les deux fenêtres communiquent par **événements Tauri** (`emit` / `listen`), pas
par état partagé : ce sont deux contextes JavaScript distincts.

**⚠ L'aperçu n'est pas une capture.** Le petit moniteur du contrôleur refait le
rendu de son côté. Il n'existe aucun moyen économique de miroiter une fenêtre
dans Tauri/WebKitGTK. Conséquence : une vidéo projetée est décodée **deux fois**.
D'où le mode « Aperçu allégé » (bouton en haut à droite du moniteur), actif par
défaut pendant le direct, qui remplace la vidéo de l'aperçu par un cartouche.
La caméra suit la même règle — et n'a pas le choix : sous V4L2, deux webviews ne
peuvent pas ouvrir le même périphérique.

---

## 2. Le serveur média local (port 11223)

Un serveur **warp** démarre avec l'application et sert le dossier de données sur
`http://127.0.0.1:11223/fs/<chemin-relatif>`.

Pourquoi pas le protocole `asset://` de Tauri ? Parce qu'il ne gère pas les
requêtes **Range**, indispensables pour se déplacer dans une vidéo ou un audio.
Le protocole asset est donc explicitement désactivé (`assetProtocol.enable:
false`).

Côté React, `cleanUrl()` (`src/lib/media.ts`) traduit un chemin disque en URL du
serveur. Il reconnaît les dossiers `/backgrounds/`, `/media/` et `/data/`.

Sécurité : le serveur n'accepte que les origines de l'application (pas
d'`allow_any_origin`) et vérifie l'en-tête `Host` contre le détournement DNS.

---

## 3. Où vivent les données

Racine (`get_data_root`) :

| Système | Chemin |
|---|---|
| Linux | `~/.local/share/com.bryan.myprojector/` |
| Windows | `%APPDATA%\com.bryan.myprojector\` |
| macOS | `~/Library/Application Support/com.bryan.myprojector/` |

```
data/hymnes/        recueils .db (SQLite)
data/bible/         bibles .SQLite3 (format MyBible)
data/docs/          documents PDF téléchargés
data/mofonaina/     trimestres de méditations (.json)
data/audio/<recueil>/  playbacks téléchargés, nommés <numéro>.mp3
data/audio/_cache/  écoutes en ligne mises en cache
data/_manifests/    catalogues distants, pour le mode hors ligne
backgrounds/        fonds importés par l'utilisateur
media/              images, vidéos, documents importés dans l'agenda
```

Le bouton **Ouvrir le dossier** de la section Stockage pointe directement là.

---

## 4. Le backend Rust (`src-tauri/src/lib.rs`)

Un seul fichier, ~2 400 lignes, organisé en blocs commentés : optimisation des
médias, bases SQLite, bibliothèque, historique, stockage, diagnostic,
télécommande, réglages WebKit.

**⚠ Les paramètres d'`invoke` sont en camelCase côté JavaScript.** Une commande
Rust `fn f(file_path: String)` s'appelle `invoke('f', { filePath })`. Avec
`file_path`, l'appel échoue silencieusement si l'erreur est avalée par un
`.catch(console.warn)` — c'est exactement comme ça que 137 Mo de médias
supposément supprimés sont restés sur le disque.

### Optimisation automatique des médias

Une vidéo 4K à gros débit fait décrocher le décodeur logiciel de WebKitGTK :
l'interface se fige plusieurs secondes en changeant de diapo. Les médias
importés sont donc re-transcodés par ffmpeg au-delà de certains seuils
(80 Mo, 1920×1080, 10 Mbps), **en place**, pour que les références existantes
restent valides.

Deux précautions : le transcodage tourne avec `nice -n 19`, et il se **met en
pause tant que la fenêtre de projection est ouverte**. Compresser pendant un
culte serait exactement le contraire du but recherché.

ffmpeg est **optionnel** : sans lui, rien n'est compressé, tout fonctionne.

---

## 5. WebKitGTK : la liste des pièges

Ce sont les vraies causes de bugs déjà corrigés. Ne pas « simplifier » ces
endroits sans relire cette section.

**Lecture automatique.** WebKit peut exiger un geste utilisateur avant de lire
une vidéo — le fond reste alors figé avec un gros bouton *play*.
`apply_media_settings()` force `media-playback-requires-user-gesture(false)`, et
est appliqué dans `on_page_load`, donc **pour chaque webview au moment où sa
page charge**. Le réglage réellement retenu par WebKit est relu et remonté dans
le Check système (« Lecture automatique des fonds »).

**⚠ La source d'une vidéo est posée en JavaScript, jamais en attribut JSX.**
Voir `src/lib/autoplay.ts` et `BackgroundVideo.tsx` :

```ts
if (el.getAttribute("src") !== src) { el.setAttribute("src", src); el.load(); }
```

Le nettoyage retire l'attribut `src` pour libérer le pipeline GStreamer. Si
`src` était aussi une prop JSX, React ne le remettrait jamais (sa valeur n'a pas
changé de son point de vue) — et sous `StrictMode`, qui monte les effets deux
fois, la vidéo resterait définitivement vide.

**⚠ `removeAttribute("src")` doit être suivi de `load()`.** Sinon l'élément
garde la position de lecture précédente : c'est ce qui faisait démarrer Genèse 1
au verset 21.

**⚠ Libérer la vidéo avant le démontage.** Détruire un `<video>` en cours de
lecture démonte le pipeline GStreamer sur la boucle principale et fige
l'interface plusieurs secondes. `releaseVideo()` coupe la source d'abord.

**⚠ `window.prompt()` et `window.confirm()` ne sont pas implémentés.** Ils
renvoient `null` / `false` sans rien afficher. Utiliser la modale interne
(`promptDialog` dans `LeftSidebar.tsx`) ou `confirm()` du plugin dialog.

**Sources blob non positionnables.** Un audio lu depuis un `blob:` ne démarre
pas forcément à 0:00. Les écoutes en ligne passent donc par un fichier de cache
servi par le serveur local, jamais par un blob.

**Fenêtre noire au lancement.** Depuis WebKitGTK 2.42, le rendu passe par un
« DMA-BUF renderer » qui échoue silencieusement sur beaucoup de configurations.
`WEBKIT_DISABLE_DMABUF_RENDERER=1` et `WEBKIT_DISABLE_COMPOSITING_MODE=1` sont
posées au démarrage — mais **seulement si l'utilisateur ne les a pas déjà
définies**, pour pouvoir diagnostiquer depuis le terminal sans recompiler.

---

## 6. Permissions Tauri

`src-tauri/capabilities/default.json`.

**⚠ `opener:allow-open-path` sans `allow` n'autorise rien.** Activer la commande
sans portée revient à refuser tous les chemins. D'où :

```json
{ "identifier": "opener:allow-open-path",
  "allow": [{ "path": "$APPDATA/*" }, { "path": "$APPDATA/**" }] }
```

Les deux motifs sont nécessaires : `*` pour les fichiers à la racine, `**` pour
les sous-dossiers. À vérifier après modification dans
`src-tauri/gen/schemas/capabilities.json`.

La CSP vit dans `tauri.conf.json` et est **compilée dans le binaire** : la
modifier impose une recompilation, pas un simple rechargement.

---

## 7. Rendu des diapos

`src/lib/slides.ts` (`getSlides`) découpe un élément en diapos projetables : sur
les **lignes vides** pour un chant, un verset ou une méditation ; sur les
**barres horizontales** (`---`, `***`, `___`) pour le Markdown. Toujours au
moins une diapo, jamais de tableau vide.

Le Markdown est rendu par `MarkdownView` (react-markdown + GFM + KaTeX). Le HTML
brut n'est **volontairement pas** interprété : les médias passent par la syntaxe
image (`![](clip.mp4)` produit une vidéo), ce qui couvre le besoin sans ouvrir
la porte à l'injection de balises dans la fenêtre de projection.

Une diapo Markdown suit les réglages de la barre d'outils (police, couleur,
alignement, taille) comme n'importe quelle autre diapo, et laisse voir le fond —
seul un voile léger est appliqué pour la lisibilité. Les styles typographiques
sont dans `src/index.css`, section `.markdown-body` : Tailwind remet à zéro les
styles par défaut, il faut donc les redonner explicitement.

---

## 8. Télécommande (port 11224)

Désactivée par défaut. Une fois activée (Bibliothèque → Télécommande), un
serveur écoute sur `0.0.0.0:11224` et sert une page mobile autonome. L'accès est
protégé par un **code à 6 chiffres** régénéré à chaque activation, et seules
onze actions nommées sont acceptées — ce n'est pas une API générique.

Le Bluetooth n'est pas utilisé : il n'existe pas de canal Bluetooth accessible
depuis un webview, et le Wi-Fi local couvre le besoin sans appairage.

---

## 9. Mise à jour

Voir [RELEASE.md](RELEASE.md). Principe côté application : on vérifie, on
propose, on n'installe jamais tout seul. Une projection ne doit pas être
interrompue par un redémarrage.
