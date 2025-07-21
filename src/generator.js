const fs = require('fs-extra');
const { exec } = require('child_process');
const path = require('path');
const parser = require('./parser');

const ADDON_ASSETS = path.join(__dirname, '..', 'addonAssets', 'main');
const OUT_DIR = path.join(__dirname, '..', 'fabricModAssets');

async function generateFabricMod(MODID = 'converted_mod') {
    await setupGradleProject(MODID);
    console.log('Gradle project files generated.');

    // Prepare output directories
    const assetsDir = path.join(OUT_DIR, 'assets', MODID);
    await fs.ensureDir(assetsDir);

    // Parse and convert block models
    const bedrockModelsDir = path.join(ADDON_ASSETS, 'models', 'blocks');
    const javaModelsDir = path.join(assetsDir, 'models', 'block');
    if (await fs.pathExists(bedrockModelsDir)) {
        await fs.ensureDir(javaModelsDir);
        const modelFiles = await fs.readdir(bedrockModelsDir);
        for (const file of modelFiles) {
            const srcPath = path.join(bedrockModelsDir, file);
            const destPath = path.join(javaModelsDir, file.replace('.json', '.json'));
            const converted = await parser.convertBlockModel(await fs.readJson(srcPath));
            await fs.writeJson(destPath, converted, { spaces: 2 });
        }
        console.log('Converted and copied block models.');
    }

    // Parse and convert block textures
    const bedrockTexturesDir = path.join(ADDON_ASSETS, 'textures', 'blocks');
    const javaTexturesDir = path.join(assetsDir, 'textures', 'block');
    if (await fs.pathExists(bedrockTexturesDir)) {
        await fs.ensureDir(javaTexturesDir);
        const textureFiles = await fs.readdir(bedrockTexturesDir);
        for (const file of textureFiles) {
            const srcPath = path.join(bedrockTexturesDir, file);
            const destPath = path.join(javaTexturesDir, file);
            await fs.copy(srcPath, destPath);
        }
        console.log('Copied block textures.');
    }

    // TEXTS (LANG FILES)
    const bedrockLangDir = path.join(ADDON_ASSETS, 'texts');
    const javaLangDir = path.join(assetsDir, 'lang');
    if (await fs.pathExists(bedrockLangDir)) {
        await fs.ensureDir(javaLangDir);
        const langFiles = await fs.readdir(bedrockLangDir);
        for (const file of langFiles) {
            const srcPath = path.join(bedrockLangDir, file);
            const destPath = path.join(javaLangDir, file.replace('.lang', '.json'));
            const converted = await parser.convertLangFile(await fs.readFile(srcPath, 'utf8'));
            await fs.writeJson(destPath, converted, { spaces: 2 });
        }
        console.log('Converted and copied lang files.');
    }

    // --- PACK META & MOD META ---
    const mcmeta = {
        pack: {
            pack_format: 15,
            description: "Converted from Bedrock addonAssets"
        }
    };
    await fs.writeJson(path.join(OUT_DIR, 'pack.mcmeta'), mcmeta, { spaces: 2 });

    const fabricModJson = {
        schemaVersion: 1,
        id: MODID,
        version: "1.0.0",
        name: "Converted Mod",
        description: "Converted from Bedrock addonAssets",
        authors: ["Auto-generated"],
        contact: {},
        license: "MIT",
        environment: "*",
        entrypoints: {},
        depends: {
            "fabricloader": ">=0.14.0",
            "minecraft": ">=1.20.0"
        }
    };
    await fs.writeJson(path.join(OUT_DIR, 'fabric.mod.json'), fabricModJson, { spaces: 2 });

    console.log('Fabric mod structure generated at:', OUT_DIR);

    await installAndBuild();
}

async function setupGradleProject(MODID) {

    await fs.ensureDir(OUT_DIR);
    const gradleDir = OUT_DIR;
    // build.gradle
    const buildGradle = `
    plugins {
        id 'fabric-loom' version '1.6-SNAPSHOT'
        id 'maven-publish'
    }

    group = 'com.example'
    version = '1.0.0'

    repositories {
        mavenCentral()
        maven { url = 'https://maven.fabricmc.net/' }
    }

    dependencies {
        minecraft 'com.mojang:minecraft:1.20.1'
        mappings 'net.fabricmc:yarn:1.20.1+build.10:v2'
        modImplementation 'net.fabricmc:fabric-loader:0.14.22'
    }

    loom {
        splitEnvironmentSourceSets()
    }

    sourceSets {
        main {
            java {
                srcDirs = ['src/main/java']
            }
            resources {
                srcDirs = ['src/main/resources']
            }
        }
    }
    `;
    await fs.writeFile(path.join(gradleDir, 'build.gradle'), buildGradle);

    // settings.gradle
    await fs.writeFile(path.join(gradleDir, 'settings.gradle'), `rootProject.name = '${MODID}'\n`);

    // gradle.properties
    await fs.writeFile(path.join(gradleDir, 'gradle.properties'), `org.gradle.jvmargs=-Xmx1G\n`);

    // Minimal mod class
    const javaDir = path.join(gradleDir, 'src', 'main', 'java', 'com', 'example', MODID);
    await fs.ensureDir(javaDir);
    const modClass = `
    package com.example.${MODID};

    import net.fabricmc.api.ModInitializer;

    public class ${capitalize(MODID)}Mod implements ModInitializer {
        @Override
        public void onInitialize() {
            System.out.println("Hello Fabric world!");
        }
    }
    `;
    await fs.writeFile(path.join(javaDir, `${capitalize(MODID)}Mod.java`), modClass);

    // Minimal fabric.mod.json in resources
    const resourcesDir = path.join(gradleDir, 'src', 'main', 'resources');
    await fs.ensureDir(resourcesDir);
    await fs.writeJson(path.join(resourcesDir, 'fabric.mod.json'), {
        schemaVersion: 1,
        id: MODID,
        version: "1.0.0",
        name: "Converted Mod",
        description: "Converted from Bedrock addonAssets",
        authors: ["Auto-generated"],
        contact: {},
        license: "MIT",
        environment: "*",
        entrypoints: {
        main: [`com.example.${MODID}.${capitalize(MODID)}Mod`]
        },
        depends: {
        "fabricloader": ">=0.14.0",
        "minecraft": ">=1.20.0"
        }
    }, { spaces: 2 });
}

async function installAndBuild() {
  // Run gradle wrapper and build
  return new Promise((resolve, reject) => {
    exec('gradlew build', { cwd: OUT_DIR }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Build error: ${stderr}`);
        reject(error);
      } else {
        console.log(stdout);
        resolve();
      }
    });
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

exports.generateFabricMod = generateFabricMod;