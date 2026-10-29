# Ocall Park Caisse — connecteur Android

Application Android légère : une WebView qui charge Ocall Park et un pont matériel sécurisé vers
l'imprimante thermique ESC/POS (réseau, Bluetooth, USB) et le tiroir-caisse.

> ⚠️ **Statut : code écrit, non compilé et non testé.** L'environnement de développement du Sprint 3
> ne dispose ni du SDK Android ni de Gradle, ni d'imprimante physique. La compilation et la
> validation matérielle sont à faire selon `docs/MATERIEL-POS.md` §7.

## Construire

Prérequis : Android Studio (ou SDK Android 34 + JDK 17).

```powershell
cd apps/android
# Génère le wrapper Gradle si besoin (Android Studio le fait à l'ouverture du projet)
gradle wrapper --gradle-version 8.7
./gradlew assembleRelease -PocallParkUrl=https://<domaine-public-du-service-web>
```

`ocallParkUrl` doit être en HTTPS : c'est l'URL chargée, et son origine est la **seule** autorisée
à utiliser le pont matériel. Signer l'APK de production avec la clé de l'entreprise (non versionnée).

## Fichiers

| Fichier                | Rôle                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `MainActivity.kt`      | WebView sécurisée, injection du pont pour l'origine autorisée seulement  |
| `HardwareBridge.kt`    | Commandes `info`, `print`, `test`, `openDrawer` ; génération de `ESC p`  |
| `CommandValidator.kt`  | Validation (miroir de `packages/shared/src/hardware/bridge-protocol.ts`) |
| `PrinterTransports.kt` | Envoi ESC/POS : TCP 9100, Bluetooth SPP, USB bulk                        |
| `UsbPermission.kt`     | Demande d'autorisation USB Android                                       |

## Protocole du pont

Message envoyé par la page : `{"id": "<uuid>", "type": "print", "printer": {"connection": "NETWORK",
"address": "192.168.1.50:9100"}, "data": "<ESC/POS en base64>"}`. Réponse :
`{"id": "<uuid>", "ok": true}` ou `{"id": "<uuid>", "ok": false, "error": "PRINTER_UNREACHABLE",
"message": "…"}`.
