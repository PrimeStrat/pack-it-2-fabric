const fs = require('fs-extra');
const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const readline = require('readline');
const parser = require('./parser');

const ADDON_ASSETS = path.join(__dirname, '..', 'addonAssets');
const OUT_DIR = path.join(__dirname, '..', 'fabricModAssets');

const SUPPORTED_VERSIONS = [
    '1.20.1'
];

async function generateFabricMod() {
    const modIdPattern = /^[a-zA-Z]+$/;
    let MODID = null;

    while (MODID == null) {
        const input = await promptUser(
            'Enter the mod ID (only letters, one word, no numbers or symbols): '
        );

        if (modIdPattern.test(input)) {
            MODID = input.toLowerCase();
        } else {
            console.log('Invalid mod ID. Please use only letters (a-z or A-Z), no numbers, symbols, or spaces.');
        }
    }

    await setupGradleProject(MODID);
    console.log('Gradle project files generated.');

    // Prepare output directories
    const assetsDir = path.join(OUT_DIR, 'src', 'main', 'resources', 'assets', MODID);
    await fs.ensureDir(assetsDir);

    // BLOCK MODELS
    /*const javaModelsDir = path.join(assetsDir, 'models', 'block');
    if (await fs.pathExists(ADDON_ASSETS)) {
        await fs.ensureDir(javaModelsDir);

        const blockFolders = await findBlockModelFolders(ADDON_ASSETS);

        if (blockFolders.length === 0) {
            console.log('No "blocks" folders found inside models.');
        }

        for (const folder of blockFolders) {
            const modelFiles = await fs.readdir(folder);
            for (const file of modelFiles) {
                if (!file.endsWith('.json')) continue;
                const srcPath = path.join(folder, file);

                const relativePath = path.relative(ADDON_ASSETS, srcPath);
                const destPath = path.join(javaModelsDir, relativePath);

                await fs.ensureDir(path.dirname(destPath));

                const bedrockJson = await fs.readJson(srcPath);
                const converted = await parser.convertBlockModel(bedrockJson);
                await fs.writeJson(destPath, converted, { spaces: 2 });
            }
        }

        console.log('Converted and copied block models recursively.');
    } else {
        console.log(`No block models found at ${ADDON_ASSETS}`);
    }*/

    // TEXTURES
    const javaTexturesDir = path.join(assetsDir, 'textures', 'block');
    if (await fs.pathExists(ADDON_ASSETS)) {
        await fs.ensureDir(javaTexturesDir);

        const textureFiles = await findAllPngTextures(ADDON_ASSETS);

        if (textureFiles.length === 0) {
            console.log('No texture files found inside any "textures" folders.');
        }

        for (const srcPath of textureFiles) {
            const relativePath = path.relative(ADDON_ASSETS, srcPath);
            const destPath = path.join(javaTexturesDir, relativePath);

            await fs.ensureDir(path.dirname(destPath));
            await fs.copy(srcPath, destPath);
        }

        console.log('Copied block textures recursively.');
    } else {
        console.log(`No block textures found at ${ADDON_ASSETS}`);
    }

    // TEXTS (LANG FILES)
    const javaLangDir = path.join(assetsDir, 'lang');
    if (await fs.pathExists(ADDON_ASSETS)) {
        await fs.ensureDir(javaLangDir);
        const langFiles = await findLangFiles(ADDON_ASSETS);

        for (const srcPath of langFiles) {
            const baseName = path.basename(srcPath).replace(/\.lang$/, '.json').toLowerCase();
            const destPath = path.join(javaLangDir, baseName);

            const langContent = await fs.readFile(srcPath, 'utf8');
            const converted = await parser.convertLangFile(langContent);
            await fs.writeJson(destPath, converted, { spaces: 2 });
        }

        console.log('Converted and copied lang files into flat structure.');
    } else {
        console.log(`No lang files found at ${ADDON_ASSETS}`);
    }

    // --- PACK META & MOD META ---
    const mcmeta = {
        pack: {
            pack_format: 15,
            description: 'Converted from Bedrock addonAssets'
        }
    };
    await fs.writeJson(path.join(OUT_DIR, 'pack.mcmeta'), mcmeta, { spaces: 2 });

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
        entrypoints: {},
        depends: {
            fabricloader: '>=0.14.0',
            minecraft: '>=1.20.0'
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

// Search functions
async function findBlockModelFolders(rootDir) {
    let blockFolders = [];
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.toLowerCase() === 'blocks') {
                blockFolders.push(fullPath);
            }
            const nested = await findBlockModelFolders(fullPath);
            blockFolders = blockFolders.concat(nested);
        }
    }
    return blockFolders;
}

async function findAllPngTextures(rootDir) {
    const results = [];

    async function recurse(currentDir) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (entry.name.toLowerCase() === 'textures') {
                    await collectPngs(fullPath);
                } else {
                    await recurse(fullPath);
                }
            }
        }
    }

    async function collectPngs(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                await collectPngs(fullPath);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
                results.push(fullPath);
            }
        }
    }

    await recurse(rootDir);
    return results;
}

async function findLangFiles(dir) {
    let results = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(await findLangFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.lang')) {
            results.push(fullPath);
        }
    }
    return results;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

exports.generateFabricMod = generateFabricMod;
