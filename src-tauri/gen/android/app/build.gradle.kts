import java.util.Properties
import com.android.build.gradle.tasks.PackageApplication

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Local release credentials are never checked into the public repository.
val releaseSigningFile = rootProject.file("../../../签名信息/signing.properties")
val releaseSigningProperties = Properties().apply {
    if (releaseSigningFile.isFile) {
        releaseSigningFile.inputStream().use { load(it) }
    }
}
val releaseRequested = gradle.startParameter.taskNames.any {
    val task = it.substringAfterLast(':')
    task.contains("release", ignoreCase = true) || task in listOf("build", "assemble", "bundle")
}
if (releaseRequested) {
    check(releaseSigningFile.isFile) { "Release signing requires 签名信息/signing.properties." }
    for (name in listOf("storeFile", "storePassword", "keyAlias", "keyPassword")) {
        check(!releaseSigningProperties.getProperty(name).isNullOrBlank()) { "Missing release signing field: $name" }
    }
    check(releaseSigningFile.parentFile.resolve(releaseSigningProperties.getProperty("storeFile")).isFile) {
        "The configured release keystore does not exist."
    }
}

android {
    compileSdk = 36
    namespace = "firefly.toolbox"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        applicationId = "firefly.toolbox"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1000000").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0.0")
    }
    signingConfigs {
        if (releaseSigningFile.isFile) {
            create("release") {
                storeFile = releaseSigningFile.parentFile.resolve(releaseSigningProperties.getProperty("storeFile"))
                storePassword = releaseSigningProperties.getProperty("storePassword")
                keyAlias = releaseSigningProperties.getProperty("keyAlias")
                keyPassword = releaseSigningProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
    packaging {
        jniLibs.useLegacyPackaging = true
    }
}

rust {
    rootDirRel = "../../../"
}

// Incremental ZIP updates can leave a native-library-sized virtual entry when
// the compressed .so grows. Recreate the final APK; compilation stays cached.
tasks.withType<PackageApplication>().configureEach {
    outputs.upToDateWhen { false }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
