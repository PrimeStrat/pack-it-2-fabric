const fs = require('fs-extra');
const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const readline = require('readline');
const glob = require('glob');
const parser = require('./parser');
const { generateJavaSources } = require('./java_initializer');

const ADDON_ASSETS = path.join(__dirname, '..', 'addonAssets');
const OUT_DIR = path.join(__dirname, '..', 'fabricModAssets');

const SUPPORTED_VERSIONS = [
    '1.20.1'
];

let selectedVersion;

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

    await setupGradleProject(MODID); // init
    console.log('Gradle project files generated.');

    // Prepare output directories
    const assetsDir = path.join(OUT_DIR, 'src', 'main', 'resources', 'assets', MODID);
    await fs.ensureDir(assetsDir);

    // BLOCK MODELS
    const javaModelsDir = path.join(assetsDir, 'models');
    if (await fs.pathExists(ADDON_ASSETS)) {
        await fs.ensureDir(javaModelsDir);

        const blockFolders = await findBlockModelFolders(ADDON_ASSETS);

        if (blockFolders.length === 0) {
            console.log('No "blocks" folders found inside models.');
        }

        const blocksMap = await collectBedrockBlocks(ADDON_ASSETS);
        for (const [blockId, blockEntry] of Object.entries(blocksMap)) {
            await parser.convertBlockModel(blockEntry, assetsDir, MODID, selectedVersion);
        }

        console.log('Converted and copied block models recursively.');
    } else {
        console.log(`No block models found at ${ADDON_ASSETS}`);
    }

    // TEXTURES
    const javaTexturesDir = path.join(assetsDir, 'textures');
    if (await fs.pathExists(ADDON_ASSETS)) {
        await fs.ensureDir(javaTexturesDir);

        // Find all folders named "textures"
        const texturesDirs = glob.sync('**/textures', {
            cwd: ADDON_ASSETS,
            absolute: true,
            nodir: false
        });

        if (texturesDirs.length === 0) {
            console.log('No "textures" folders found.');
        }

        for (const texDir of texturesDirs) {
            const subdirs = await fs.readdir(texDir);

            for (const sub of subdirs) {
                const srcSubDir = path.join(texDir, sub);
                const destSubDir = path.join(javaTexturesDir, sub);

                const stats = await fs.stat(srcSubDir);
                if (stats.isDirectory()) {
                    await fs.copy(srcSubDir, destSubDir, { overwrite: true });
                }
            }
        }

        console.log('Copied texture folders (block, item, etc.) into "textures".');
    } else {
        console.log(`No textures found at ${ADDON_ASSETS}`);
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

    // PACK META & MOD META
    const mcmeta = {
        pack: {
            pack_format: 15,
            description: 'Converted using Pack It 2 Fabric'
        }
    };
    await fs.writeJson(path.join(OUT_DIR, 'pack.mcmeta'), mcmeta, { spaces: 2 });

    const fabricModJson = {
        schemaVersion: 1,
        id: MODID,
        version: '1.0.0',
        name: `${MODID} (CONVERTED)`,
        description: 'Converted using Pack It 2 Fabric',
        authors: ['Auto-generated'],
        contact: {},
        license: 'MIT',
        environment: '*',
        entrypoints: {
            "main": [`com.${MODID}.${MODID.toUpperCase()}`]
        },
        depends: {
            fabricloader: '>=0.14.0',
            minecraft: '>=1.20.0'
        }
    };
    await fs.writeJson(path.join(OUT_DIR, 'fabric.mod.json'), fabricModJson, { spaces: 2 });

    console.log('Fabric mod structure generated at:', OUT_DIR);

    await setupGradleProject(MODID);
    await installAndBuild(MODID);
}

async function setupGradleProject(MODID) {
    // Pick version
    console.log('Supported Minecraft versions:');
    SUPPORTED_VERSIONS.forEach((v, i) => console.log(`${i + 1}. ${v}`));

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
    await generateJavaSources(MODID, OUT_DIR, selectedVersion)

    const settingsGradleContent = `
        pluginManagement {
        repositories {
            maven {
                name = 'Fabric'
                url = 'https://maven.fabricmc.net/'
            }
            mavenCentral()
            gradlePluginPortal()
        }
    }
    `.trim();

    await fs.writeFile(path.join(OUT_DIR, 'settings.gradle'), settingsGradleContent);

    // fabric.mod.json
    const resourcesDir = path.join(OUT_DIR, 'src', 'main', 'resources');
    await fs.ensureDir(resourcesDir);

    const fabricModJson = {
        schemaVersion: 1,
        id: MODID.toLowerCase(),  
        version: '1.0.0',         
        name: MODID.toUpperCase(), 
        description: `Converted using Pack It 2 Fabric for ${MODID}`,
        authors: ['Auto-generated'],
        contact: {
            homepage: "",
            sources: ""
        },
        license: "MIT", 
        icon: "*",
        environment: "*",
        entrypoints: {
            main: [`com.${MODID.toLowerCase()}.${MODID.toUpperCase()}`],
            "fabric-datagen": [`com.${MODID.toLowerCase()}.${MODID.toUpperCase()}DataGenerator`],
            client: [`com.${MODID.toLowerCase()}.${MODID.toUpperCase()}Client`]
        },
        depends: {
            fabricloader: ">=0.15.0",
            minecraft: "~1.20.1",
            java: ">=17",
            "fabric-api": "*"
        },
        suggests: {
            "another-mod": "*"
        }
        };

    await fs.writeJson(path.join(resourcesDir, 'fabric.mod.json'), fabricModJson, { spaces: 2 });

    console.log(`Setup complete! Using Minecraft version: ${selectedVersion}`);
}

async function scaffoldProject() {
    if (!fs.existsSync(path.join(OUT_DIR, 'build.gradle'))) {
        console.log('No Gradle project detected. Scaffolding Fabric example mod...');
        // Option 1: clone Fabric example mod
        await new Promise((resolve, reject) => {
            exec(`git clone https://github.com/FabricMC/fabric-example-mod.git ${OUT_DIR}`, (err, stdout, stderr) => {
                if (err) return reject(err);
                console.log(stdout);
                resolve();
            });
        });
        console.log('Project scaffolded successfully.');
    } else {
        console.log('Gradle project already exists in OUT_DIR.');
    }
}

async function generateWrapper() {
    if (!fs.existsSync(path.join(OUT_DIR, 'gradlew'))) {
        console.log('Generating Gradle wrapper...');
        await new Promise((resolve, reject) => {
            exec('gradle wrapper', { cwd: OUT_DIR }, (err, stdout, stderr) => {
                if (err) return reject(stderr || err);
                console.log(stdout);
                resolve();
            });
        });

        if (process.platform !== 'win32') {
            await new Promise((resolve, reject) => {
                exec('chmod +x gradlew', { cwd: OUT_DIR }, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        }

        console.log('Gradle wrapper generated.');
    } else {
        console.log('Gradle wrapper already exists.');
    }
}

async function killGradleProcesses() {
    return new Promise((resolve, reject) => {
        const cwd = path.resolve(OUT_DIR);

        if (process.platform === 'win32') {
            const cmd = `wmic process where "name='java.exe'" get ProcessId,CommandLine`;
            exec(cmd, (err, stdout, stderr) => {
                if (err) {
                    console.warn('Error listing processes:', err);
                    return resolve();
                }

                const lines = stdout.split(/\r?\n/).filter(Boolean).slice(1);
                lines.forEach(line => {
                    const match = line.match(/(\d+)\s*$/);
                    if (!match) return;
                    const pid = match[1];
                    if (line.includes(cwd)) {
                        exec(`taskkill /PID ${pid} /F`, (err) => {
                            if (err) console.warn(`Failed to kill PID ${pid}:`, err);
                        });
                    }
                });

                resolve();
            });
        } else {
            const cmd = `pgrep -f "${cwd}"`;
            exec(cmd, (err, stdout) => {
                if (!stdout) return resolve();
                const pids = stdout.split(/\r?\n/).filter(Boolean);
                pids.forEach(pid => {
                    exec(`kill -9 ${pid}`, (err) => {
                        if (err) console.warn(`Failed to kill PID ${pid}:`, err);
                    });
                });
                resolve();
            });
        }
    });
}

async function buildProject() {
    await killGradleProcesses(); 
    console.log('Existing Gradle processes terminated.');

    const buildCmd = process.platform === 'win32' ? 'gradlew.bat build' : './gradlew clean build';

    await new Promise((resolve, reject) => {
        exec(buildCmd, { cwd: OUT_DIR }, (err, stdout, stderr) => {
            if (err) return reject(stderr || err);
            console.log(stdout);
            resolve();
        });
    });

    console.log('Build complete.');
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

async function installAndBuild(MODID) {
    try {
        await checkAndMaybeInstallGradle();  
        await scaffoldProject();            
        await generateWrapper();             
        await buildProject().catch(console.error);      
        outputMod(MODID);
    } catch (err) {
        console.error('An error occurred:', err);
        process.exit(1);
    }
}

async function outputMod(MODID){
    const OUT_DIR = path.resolve(__dirname, '../fabricModAssets'); 
    const libsDir = path.join(OUT_DIR, 'build', 'devlibs');

    if (!fs.existsSync(libsDir)) {
        console.error('Unable to locate generated mod');
        return;
    }

    const files = fs.readdirSync(libsDir);
    const jarFile = files.find(file =>
        file.endsWith('.jar')
    );

    if (!jarFile) {
        console.error('No .jar file found in build/libs.');
        return;
    }

    const newJarName = `${MODID}.jar`;
    const oldJarPath = path.join(libsDir, jarFile);

    const targetDir = await promptUser('Enter the full path of the directory to output the .jar file to: ');
    const resolvedTargetDir = path.resolve(targetDir);

    if (!fs.existsSync(resolvedTargetDir)) {
        console.error('Target directory does not exist.');
        return;
    }

    const newJarPath = path.join(resolvedTargetDir, newJarName);

    fs.copyFileSync(oldJarPath, newJarPath);
    console.log(`Bedrock Addon was converted to: ${newJarPath}`);
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
async function collectBedrockBlocks(ADDON_ASSETS) {
    const blocksData = {}; // { blockId: { blockJson, geometryRef, geoJson } }
    const geometryMap = {}; // geometryIdentifier -> geoJson

    const blockFolders = await findBlockModelFolders(ADDON_ASSETS);
    if (blockFolders.length === 0) {
        console.warn(`No block model folders found in ${ADDON_ASSETS}`);
        return blocksData;
    }

    for (const folder of blockFolders) {
        console.log(`Scanning folder: ${folder}`);
        const files = await fs.readdir(folder);

        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const fullPath = path.join(folder, file);
            let jsonData;
            try {
                jsonData = await fs.readJson(fullPath);
            } catch (err) {
                console.warn(`Failed to read JSON file: ${fullPath}`, err);
                continue;
            }

            // Detect geometry JSON by content, not filename
            const geoArray = jsonData['minecraft:geometry'];
            if (Array.isArray(geoArray) && geoArray[0]?.description?.identifier?.startsWith("geometry")) {
                const geoIdentifier = geoArray[0].description.identifier;
                geometryMap[geoIdentifier] = jsonData;
                continue; // skip adding to blocksData
            }

            // Otherwise, treat as block JSON
            const blockId = jsonData?.description?.identifier || path.basename(file, '.json');
            blocksData[blockId] = blocksData[blockId] || {};
            blocksData[blockId].blockJson = jsonData;

            const geometryRef = jsonData?.components?.['minecraft:geometry'];
            if (geometryRef) {
                blocksData[blockId].geometryRef = geometryRef;
            }
        }
    }

    // Attach the correct geoJson for each block
    for (const [blockId, entry] of Object.entries(blocksData)) {
        const blockComponents = entry.blockJson?.["minecraft:block"]?.components;
        let geometryName = blockComponents?.["minecraft:geometry"] || entry.geometryRef;

        // Fallback to default geometry if none exists
        if (!geometryName) {
            geometryName = "geometry.block";
        }

        if (geometryMap[geometryName]) {
            entry.geoJson = geometryMap[geometryName];
        } else {
            entry.geoJson = null;
        }
    }

    console.log(`Collected ${Object.keys(blocksData).length} blocks and ${Object.keys(geometryMap).length} geometries`);
    return blocksData;
}

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

exports.generateFabricMod = generateFabricMod;
