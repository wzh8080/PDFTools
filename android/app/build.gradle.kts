import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * Web 源码就是仓库根目录里的 pdf-splitter/（PWA 本体）。
 * 构建前自动同步进 assets/www，避免两处副本互相漂移；该目录已加入 .gitignore。
 */
val webSrc = rootProject.file("../pdf-splitter")
val webOut = file("src/main/assets/www")

val syncWebAssets by tasks.registering(Sync::class) {
    from(webSrc) {
        include("index.html", "app.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png")
        include("lib/**")
    }
    into(webOut)
}

val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.pdfsplitter.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pdfsplitter.app"
        minSdk = 29
        targetSdk = 36
        versionCode = 10
        versionName = "1.5.0"
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("META-INF/*", "LICENSE.txt")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

tasks.named("preBuild") { dependsOn(syncWebAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.13.0")
}
