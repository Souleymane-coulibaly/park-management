plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ocallParkUrl: String = (project.findProperty("ocallParkUrl") as String?) ?: "https://ocall-park.invalid"
require(ocallParkUrl.startsWith("https://")) { "ocallParkUrl doit être une URL HTTPS." }
val ocallParkOrigin: String = ocallParkUrl.trimEnd('/').let { url ->
    val afterScheme = url.removePrefix("https://")
    "https://" + afterScheme.substringBefore('/')
}

android {
    namespace = "com.ocallpark.pos"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ocallpark.pos"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.3.0"
        buildConfigField("String", "APP_URL", "\"$ocallParkUrl\"")
        // Seule cette origine peut appeler le pont matériel.
        buildConfigField("String", "ALLOWED_ORIGIN", "\"$ocallParkOrigin\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    testImplementation("junit:junit:4.13.2")
}
