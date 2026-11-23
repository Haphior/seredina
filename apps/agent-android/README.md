# Seredina Agent for Android

Reports a phone's or tablet's inventory to Seredina: model, Android
version and security patch, SIMs, screen lock, encryption, battery,
storage and installed apps. It never controls the device. See
`docs/adr/0078-mobile-inventory.md` and the guide's "Phones and tablets"
section.

## Build

Needs JDK 17, Gradle 8.14 and the Android SDK (platform 35).

```bash
gradle -p apps/agent-android testDebugUnitTest assembleDebug
```

CI builds it on every change (`.github/workflows/android-agent.yml`), and
`release.yml` attaches the signed `seredina-agent-android.apk` to each
Seredina release. The version comes from the repository's `package.json`.

## Release signing

Android installs an update only when it's signed with the same key as the
installed app. Create a key once and store it as repository secrets:

```bash
keytool -genkeypair -keystore seredina-release.jks -alias seredina \
  -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=Seredina Agent"
base64 -w0 seredina-release.jks   # -> ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The keystore, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Its password |
| `ANDROID_KEY_ALIAS` | `seredina` |
| `ANDROID_KEY_PASSWORD` | The key's password (defaults to the keystore's) |

Keep a copy of the keystore somewhere safe. Without it, every phone has to
uninstall the app and enroll again.
