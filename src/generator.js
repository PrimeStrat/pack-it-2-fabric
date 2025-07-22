const fs = require('fs-extra');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const readline = require('readline');
const parser = require('./parser');

const ADDON_ASSETS = path.join(__dirname, '..', 'addonAssets', 'main');
const OUT_DIR = path.join(__dirname, '..', 'fabricModAssets');

const SUPPORTED_VERSIONS = [
    '1.20.1'
];

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
    // Pick version
    console.log('Supported Minecraft versions:');
    SUPPORTED_VERSIONS.forEach((v, i) => console.log(`${i + 1}. ${v}`));
  
    let selectedVersion;
    while (!selectedVersion) {
        const answer = await promptUser('Select Minecraft version by number: ');
        const idx = parseInt(answer, 10) - 1;
        if (idx >= 0 && idx < SUPPORTED_VERSIONS.length) {
            selectedVersion = SUPPORTED_VERSIONS[idx];
        } else {
            console.log('Invalid selection, please try again.');
        }
    }

    async function promptUser(question) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
         });
        return new Promise((resolve) => {
        rl.question(question, (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
      }
  
    await fs.ensureDir(OUT_DIR);
  
    // Generate build.gradle with selectedVersion
    const buildGradle = `
        plugins {
            id 'fabric-loom' version '1.5.4'
            id 'maven-publish'
        }
        
        group = 'com.example'
        version = '1.0.0'
        
        repositories {
            mavenCentral()
            maven { url = 'https://maven.fabricmc.net/' }
        }
        
        dependencies {
            minecraft 'com.mojang:minecraft:${selectedVersion}'
            mappings 'net.fabricmc:yarn:${selectedVersion}+build.10:v2'
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
  `.trimStart();

  const settingsGradle = `
        pluginManagement {
            repositories {
                gradlePluginPortal()
                maven { url = 'https://maven.fabricmc.net/' }
            }
        }

        rootProject.name = '${MODID}'
    `.trimStart();
  
    await fs.writeFile(path.join(OUT_DIR, 'build.gradle'), buildGradle);
    await fs.writeFile(path.join(OUT_DIR, 'settings.gradle'), settingsGradle);
    await fs.writeFile(path.join(OUT_DIR, 'gradle.properties'), 'org.gradle.jvmargs=-Xmx1G\n');
  
    // Java source
    const javaDir = path.join(OUT_DIR, 'src', 'main', 'java', 'com', 'example', MODID);
    await fs.ensureDir(javaDir);
  
    const modClass = `
        package com.example.${MODID};
        
        import net.fabricmc.api.ModInitializer;
        
        public class ${capitalize(MODID)}Mod implements ModInitializer {
            @Override
            public void onInitialize() {
                System.out.println("Successfully running converted addon as: ${capitalize(MODID)}");
            }
        }
  `.trimStart();
  
    await fs.writeFile(path.join(javaDir, `${capitalize(MODID)}Mod.java`), modClass);
  
    // fabric.mod.json
    const resourcesDir = path.join(OUT_DIR, 'src', 'main', 'resources');
    await fs.ensureDir(resourcesDir);
  
    const fabricModJson = {
        schemaVersion: 1,
        id: MODID,
        version: '1.0.0',
        name: 'Converted Mod',
        description: 'Converted from Bedrock addonAssets',
        authors: ['Auto-generated'],
        contact: {},
        license: 'MIT',
        environment: '*',
        entrypoints: {
            main: [`com.example.${MODID}.${capitalize(MODID)}Mod`],
        },
        depends: {
            fabricloader: '>=0.14.0',
            minecraft: `>=${selectedVersion}`,
        },
    };
  
    await fs.writeJson(path.join(resourcesDir, 'fabric.mod.json'), fabricModJson, { spaces: 2 });
  
    console.log(`Setup complete! Using Minecraft version: ${selectedVersion}`);
}

async function installAndBuild() {
    function promptUser(question) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        return new Promise((resolve) => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer.trim().toLowerCase());
            });
        });
    }
  
    async function installGradle() {
        const platform = os.platform();
        console.log(`Attempting to install Gradle on ${platform}...`);
      
        return new Promise((resolve, reject) => {
            let cmd;
            let args;
        
            if (platform === 'darwin') {
                cmd = 'brew';
                args = ['install', 'gradle'];
            } else if (platform === 'linux') {
                cmd = 'sudo';
                args = ['apt', 'install', '-y', 'gradle'];
            } else if (platform === 'win32') {
                cmd = 'choco';
                args = ['install', 'gradle', '-y'];
            } else {
                return reject(new Error(`Unsupported platform: ${platform}`));
            }
        
            const installer = spawn(cmd, args, { stdio: 'inherit' });
        
            installer.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`${cmd} exited with code ${code}`));
                }
            });
        
            installer.on('error', (err) => {
                reject(err);
            });
        });
    }
  
    async function checkAndMaybeInstallGradle() {
        return new Promise((resolve, reject) => {
            exec('gradle -v', async (error) => {
                if (!error) {
                    console.log('Gradle is already installed.');
                    return resolve();
                }
        
                console.warn('Gradle is not installed on your system.');
                const answer = await promptUser('Would you like to install Gradle now? (y/n): ');
                if (answer === 'y' || answer === 'yes') {
                    try {
                        await installGradle();
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    reject(new Error('Gradle is required but not installed.'));
                }
            });
        });
    }
  
    const gradlewPath = path.join(OUT_DIR, 'gradlew');
  
    try {
      if (!fs.existsSync(gradlewPath)) {
            console.log('gradlew not found. Trying to generate wrapper...');
    
            await checkAndMaybeInstallGradle();
    
            // Generate wrapper
            await new Promise((resolve, reject) => {
                exec('gradle wrapper', { cwd: OUT_DIR }, (error, stdout, stderr) => {
                    if (error) {
                        console.error('Failed to generate gradlew:', stderr);
                        return reject(error);
                    }
                    console.log('gradlew generated successfully.');
                    resolve();
                });
            });
      }
  
      // Make gradlew executable (on Unix)
      if (os.platform() !== 'win32') {
            await new Promise((resolve, reject) => {
                exec('chmod +x gradlew', { cwd: OUT_DIR }, (error) => {
                    if (error) return reject(`chmod failed: ${error}`);
                    resolve();
                });
            });
      }
  
      // Run build
      await new Promise((resolve, reject) => {
        const buildCmd = os.platform() === 'win32' ? 'gradlew.bat build' : './gradlew build';
            exec(buildCmd, { cwd: OUT_DIR }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Build error:\n${stderr}`);
                    return reject(error);
                }
                console.log(stdout);
                resolve();
            });
        });
    
        console.log('Build complete.');
    } catch (err) {
        console.error('An error occurred:', err.message || err);
        process.exit(1);
    }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

exports.generateFabricMod = generateFabricMod;