import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

// One source, built by two Gradle builds with different Kotlin versions (the phone app's Expo build,
// 2.2.x, and watch/, 2.4.x); the Kotlin plugin comes from whichever build includes this project, so
// it is applied here without a version.
plugins {
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        // The older of the two builds sets the language: nothing newer than 2.2 may be used here.
        languageVersion.set(KotlinVersion.KOTLIN_2_2)
        apiVersion.set(KotlinVersion.KOTLIN_2_2)
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // Android provides org.json at runtime on both the phone and the watch, so nothing is shipped;
    // the artifact is only here for the compiler and for tests, where the Android stub does not run.
    compileOnly("org.json:json:20240303")
    testImplementation("org.json:json:20240303")
    testImplementation("junit:junit:4.13.2")
}
