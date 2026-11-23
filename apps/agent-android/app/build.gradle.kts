plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The APK carries the version of the Seredina release it ships with
// (docs/adr/0078-mobile-inventory.md), read from the repository's package.json.
val seredinaVersion: String = Regex("\"version\"\\s*:\\s*\"(\\d+\\.\\d+\\.\\d+)\"")
    .find(rootDir.resolve("../../package.json").readText())
    ?.groupValues?.get(1) ?: "0.0.0"
val versionParts = seredinaVersion.split(".").map { it.toInt() }

// Release signing comes from CI secrets (see .github/workflows/android-agent.yml);
// without them a release build is left unsigned.
val keystoreFile: String? = System.getenv("ANDROID_KEYSTORE_FILE")

android {
    namespace = "org.seredina.agent"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.seredina.agent"
        minSdk = 26
        targetSdk = 35
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
        versionName = seredinaVersion
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystoreFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // QR scanning, camera permission included. Pulls in no AndroidX.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
}
