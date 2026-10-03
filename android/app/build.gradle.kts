import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI stamps each build with the Actions run number so `adb install -r` always upgrades.
val buildNumber: Int = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "com.heydenberk.stacker"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.heydenberk.stacker"
        minSdk = 26
        targetSdk = 34
        versionCode = buildNumber
        versionName = "0.1.$buildNumber"

        buildConfigField("String", "STACKER_URL", "\"https://heydenberk.com/stacker/\"")
    }

    // A fixed debug key keeps the signature identical across CI runs, so `adb install -r` upgrades
    // in place without wiping the WebView's Spotify sign-in. The keystore is NOT in git: CI decodes it
    // from the ANDROID_DEBUG_KEYSTORE_B64 Actions secret (see .github/workflows/android.yml); the
    // original lives at android/app/debug.keystore on Eric's Mac (gitignored).
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
            storeType = "pkcs12"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}
