# Dépannage

**Premier réflexe : Bibliothèque → Diagnostic.** Le Check système teste les
codecs, la lecture automatique, le serveur média, ffmpeg, les écrans, les
contenus installés et l'espace disque. La plupart des cas ci-dessous y
apparaissent directement.

---

## Vidéos

### Aucune vidéo ne se lit (fond ou agenda)

Codec H.264 absent. **`ffmpeg` ne suffit pas** : WebKit passe par GStreamer, pas
par la ligne de commande ffmpeg. C'est un piège classique — on installe ffmpeg,
le Check système passe au vert sur cette ligne, et les vidéos ne marchent
toujours pas.

```bash
sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-good gstreamer1.0-plugins-bad
```

Vérification : `gst-inspect-1.0 avdec_h264` doit répondre.

Le `.deb` déclare ces paquets en dépendances ; l'AppImage embarque les codecs
(`bundleMediaFramework`).

### La vidéo de fond affiche un bouton *play* et ne démarre pas

WebKit exige un geste utilisateur. La ligne **« Lecture automatique des fonds »**
du Check système donne la réponse, car elle relit ce que WebKit a réellement
retenu :

| Ligne | Signification |
|---|---|
| ✅ vert | WebKit accepte — si ça ne démarre toujours pas, c'est un codec |
| ❌ rouge | WebKit refuse le réglage sur cette version de WebKitGTK |

Contournement immédiat : un clic n'importe où dans la fenêtre de projection
débloque la lecture pour toute la session.

### L'interface se fige plusieurs secondes en changeant de diapo

Vidéo trop lourde. L'application re-transcode automatiquement au-delà de 80 Mo,
1920×1080 ou 10 Mbps — **si ffmpeg est installé**. La compression est mise en
pause tant que la fenêtre de projection est ouverte : ferme le direct quelques
minutes pour la laisser se faire.

---

## Lancement

### Fenêtre noire, l'application se lance mais n'affiche rien

Le « DMA-BUF renderer » de WebKitGTK ≥ 2.42 échoue silencieusement sur beaucoup
de configurations (pilotes NVIDIA propriétaires, Mesa ancien, machines
virtuelles, Wayland + Xwayland). L'application pose déjà les contournements.

Pour tester d'autres combinaisons sans recompiler — les variables déjà définies
par l'utilisateur ne sont jamais écrasées :

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=0 ./MyProjector.AppImage
WEBKIT_DISABLE_COMPOSITING_MODE=0 ./MyProjector.AppImage
```

### La projection s'ouvre sur le même écran

Un seul moniteur détecté (le Check système l'indique). La fenêtre se place sur
le dernier moniteur de la liste ; brancher l'écran **avant** de lancer
l'application.

---

## Bibliothèque et contenus

### « Je suis connecté mais il dit que je ne le suis pas » (Mofon'aina)

Quota de l'API GitHub atteint : 60 appels par heure et par adresse IP. Le
message le précise désormais. Les trimestres déjà téléchargés restent
accessibles, et le catalogue est servi depuis le cache local.

### Hors ligne, je ne vois plus ce que j'ai téléchargé

Ne devrait plus arriver : les catalogues sont mis en cache dans
`data/_manifests/` et le Mofon'aina liste aussi le contenu du disque. Si le
problème persiste, c'est que le catalogue n'a **jamais** été chargé sur cette
machine — se connecter une fois suffit à l'amorcer.

### Un playback ne se lit pas

L'application cherche d'abord le fichier local `<numéro>.mp3`, puis le flux en
ligne. Si les deux échouent, elle le dit sans planter. Télécharger la piste
depuis la bibliothèque règle le cas définitivement.

### Un .pptx ou .docx ne s'ouvre pas

Ces formats ne sont pas affichables dans la fenêtre de projection ; ils sont
confiés au programme par défaut de la machine (LibreOffice, WPS, OnlyOffice…).
Si le message est *Not allowed to open path*, c'est un problème de portée dans
`capabilities/default.json` — voir la section 6 de
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Espace disque

**Bibliothèque → Stockage** : détail par dossier, ouverture du dossier réel,
suppression fichier par fichier, nettoyage des téléchargements interrompus
(`.part`) et vidage du cache des écoutes en ligne.

Une suppression retire vraiment le fichier du disque. Si un doute subsiste,
ouvrir le dossier depuis cette même page et vérifier.

---

## Mise à jour

### Aucune mise à jour proposée alors qu'une version est publiée

1. La release est-elle **publiée** ou encore en brouillon ? Un brouillon
   n'apparaît pas dans `releases/latest`.
2. La vérification n'a lieu qu'une fois par tranche de 6 h. Forcer :
   **Bibliothèque → Mise à jour → Vérifier**.
3. Un « Plus tard » sur cette version-là la masque jusqu'à la suivante.

### « La mise à jour automatique ne s'applique pas »

Installation par paquet système (`.deb` / `.rpm`). Normal — voir
[RELEASE.md](RELEASE.md). Télécharger le nouveau paquet, ou passer à l'AppImage
pour bénéficier de la mise à jour automatique.

---

## Développement

### `cargo`, `python3` ou `npm` échouent avec un chemin introuvable

Le répertoire courant du terminal est resté dans `src-tauri/`. Revenir à la
racine du dépôt.

### Une commande Rust semble ne rien faire

Vérifier le nom des paramètres : **camelCase côté JavaScript**
(`invoke('delete_media', { filePath })`), et ne pas avaler l'erreur dans un
`.catch(console.warn)`.

### La CSP bloque une ressource

Elle est dans `tauri.conf.json` et **compilée dans le binaire** : recompiler,
un rechargement ne suffit pas.
