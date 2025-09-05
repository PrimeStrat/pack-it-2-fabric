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
    const javaTexturesDir = path.join(assetsDir, 'textures', 'block');
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
            // Recursively find .png files inside this textures folder
            const pngFiles = glob.sync('**/*.png', {
                cwd: texDir,
                absolute: true
            });

            for (const file of pngFiles) {
                const fileName = path.basename(file);
                const destFile = path.join(javaTexturesDir, fileName);

                // Copy each .png into textures/block/
                await fs.copy(file, destFile, { overwrite: true });
            }
        }

        console.log('Inserted texture files into "textures/block/".');
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
        environment: "*",
        entrypoints: {
            main: [`com.${MODID.toLowerCase()}.${MODID.toUpperCase()}`],
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
    await fs.writeJson(path.join(OUT_DIR, 'fabric.mod.json'), fabricModJson, { spaces: 2 });

    console.log('Fabric mod structure generated at:', OUT_DIR);

    await setupGradleProject(MODID);
    await installAndBuild(MODID);
}

async function findJDK17() {
    try {
        let jdkPath;

        if (os.platform() === 'win32') {
            jdkPath = process.env.JAVA_HOME;
            if (jdkPath && jdkPath.includes('jdk-17') && fs.existsSync(jdkPath)) return jdkPath;

            const possiblePaths = [
                'C:\\Program Files\\Java\\jdk-17',
                'C:\\Program Files\\Java\\jdk-17.0.8',
                'C:\\Program Files\\AdoptOpenJDK\\jdk-17',
                'C:\\Program Files\\Zulu\\zulu-17'
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) return p;
            }

        } else if (os.platform() === 'darwin') {
            try {
                jdkPath = execSync('/usr/libexec/java_home -v 17', { encoding: 'utf8' }).trim();
                if (fs.existsSync(jdkPath)) return jdkPath;
            } catch { /* ignore if not found */ }

        } else {
            // Linux: check JAVA_HOME first
            jdkPath = process.env.JAVA_HOME;
            if (jdkPath && jdkPath.includes('java-17') && fs.existsSync(jdkPath)) return jdkPath;

            // Check common locations
            const possiblePaths = [
                '/usr/lib/jvm/java-17-openjdk-amd64',
                '/usr/lib/jvm/jdk-17',
                '/usr/lib/jvm/java-17'
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) return p;
            }

            // Fallback: try update-alternatives
            try {
                const altPath = execSync("update-alternatives --list java | grep 'java-17'", { encoding: 'utf8' }).trim();
                if (altPath) return path.resolve(altPath, '../../');
            } catch { /* ignore if command fails */ }
        }

        throw new Error('JDK 17 not found.');
    } catch (err) {
        console.error('Could not find JDK 17 automatically:', err.message);
        process.exit(1);
    }
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

    const gradleProperties = `
# Done to increase the memory available to gradle.
org.gradle.jvmargs=-Xmx4G

# Fabric Properties
# check these on https://modmuss50.me/fabric.html
minecraft_version=1.20.1
yarn_mappings=1.20.1+build.10
loader_version=0.17.2

# Mod Properties
mod_version = 1.0

# Dependencies
# check this on https://modmuss50.me/fabric.html
fabric_version=0.92.6+1.20.1

    `.trim();

    await fs.writeFile(path.join(OUT_DIR, 'gradle.properties'), gradleProperties, 'utf8');

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
        environment: "*",
        entrypoints: {
            main: [`com.${MODID.toLowerCase()}.${MODID.toUpperCase()}`],
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

async function installAndBuild(MODID) {
    const jdkPath = await findJDK17(); 
    const normalizedJdkPath = jdkPath.replace(/\\/g, '/');
    const gradlePropsPath = path.join(OUT_DIR, 'gradle.properties');
    await fs.ensureFile(gradlePropsPath);
    await fs.appendFile(gradlePropsPath, `org.gradle.java.home=${normalizedJdkPath}\n`);

    async function installGradle() {
        const platform = os.platform();
        console.log(`Attempting to install Gradle on ${platform}...`);

        return new Promise((resolve, reject) => {
            let cmd, args;

            if (platform === 'darwin') {
                cmd = 'brew'; args = ['install', 'gradle'];
            } else if (platform === 'linux') {
                cmd = 'sudo'; args = ['apt', 'install', '-y', 'gradle'];
            } else if (platform === 'win32') {
                cmd = 'choco'; args = ['install', 'gradle', '-y'];
            } else {
                return reject(new Error(`Unsupported platform: ${platform}`));
            }

            const installer = spawn(cmd, args, { stdio: 'inherit' });
            installer.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)));
            installer.on('error', reject);
        });
    }

    async function checkAndMaybeInstallGradle() {
        return new Promise((resolve, reject) => {
            exec('gradle -v', async (error) => {
                if (!error) return resolve();

                console.warn('Gradle is not installed.');
                const answer = await promptUser('Would you like to install Gradle now? (y/n): ');
                if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                    try { await installGradle(); resolve(); } 
                    catch (err) { reject(err); }
                } else reject(new Error('Gradle is required but not installed.'));
            });
        });
    }

    async function killGradleDaemons() {
        if (os.platform() === 'win32') {
            await new Promise((resolve, reject) => {
                const cmd = `wmic process where "name='java.exe' and commandline like '%GradleDaemon%'" call terminate`;
                exec(cmd, (error, stdout, stderr) => error ? reject(error) : (console.log(stdout), console.error(stderr), resolve()));
            });
        }
    }

    const gradlewPath = path.join(OUT_DIR, 'gradlew');

    try {
        if (!fs.existsSync(gradlewPath)) {
            console.log('Generating Gradle wrapper...');
            await checkAndMaybeInstallGradle();

            // Generate wrapper
            await new Promise((resolve, reject) => {
                exec('gradle wrapper', { cwd: OUT_DIR, env: process.env }, (error, stdout, stderr) => {
                    if (error) {
                        console.error(stderr);
                        return reject(error);
                    }
                    console.log(stdout);
                    console.log('gradlew generated successfully.');
                    resolve();
                });
            });
        }

        if (os.platform() !== 'win32') {
            await new Promise((resolve, reject) => {
                exec('chmod +x gradlew', { cwd: OUT_DIR }, (error) => error ? reject(`chmod failed: ${error}`) : resolve());
            });
        }

        await killGradleDaemons();

        // Build with gradlew
        await new Promise((resolve, reject) => {
            let buildCmd, args;
            if (os.platform() === 'win32') {
                buildCmd = 'cmd.exe';
                args = ['/c', 'gradlew.bat', 'clean', 'build', '--stacktrace', '--info'];
            } else {
                buildCmd = './gradlew';
                args = ['clean', 'build', '--stacktrace', '--info'];
            }

            const proc = spawn(buildCmd, args, {
                cwd: OUT_DIR,
                env: process.env, // <-- passes JAVA_HOME to Gradle
                stdio: 'inherit',
            });

            proc.on('error', reject);
            proc.on('close', code => code !== 0 ? reject(new Error(`Gradle exited with code ${code}`)) : resolve());
        });

        console.log('Build complete.');
    } catch (err) {
        console.error('An error occurred:', err.message || err);
        process.exit(1);
    }

    outputMod(MODID);
}

async function outputMod(MODID){
    const OUT_DIR = path.resolve(__dirname, '../fabricModAssets'); 
    const libsDir = path.join(OUT_DIR, 'build', 'libs');

    if (!fs.existsSync(libsDir)) {
        console.error('Build/libs folder does not exist.');
        return;
    }

    const files = fs.readdirSync(libsDir);
    const jarFile = files.find(file =>
        file.endsWith('.jar') &&
        !file.endsWith('-source.jar')
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
    const blocksData = {};
    const geometryMap = {};

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

            const isBlockJson = !!jsonData['minecraft:block'];
            const geoArray = jsonData['minecraft:geometry'];

            if (Array.isArray(geoArray) && !isBlockJson) {
                const geoIdentifier = geoArray[0]?.description?.identifier;
                if (geoIdentifier && geoIdentifier.startsWith("geometry")) {
                    geometryMap[geoIdentifier] = jsonData;
                    continue;
                }
            }

            const blockId = jsonData?.description?.identifier || path.basename(file, '.json');
            blocksData[blockId] = blocksData[blockId] || {};
            blocksData[blockId].blockJson = jsonData;
            blocksData[blockId].geometryRefs = blocksData[blockId].geometryRefs || [];

            let topGeoRef = jsonData?.components?.['minecraft:geometry'];

            if (!topGeoRef) {
                topGeoRef = jsonData?.["minecraft:block"]?.components?.["minecraft:geometry"];
            }

            if (topGeoRef) {
                blocksData[blockId].geometryRefs.push(topGeoRef);
                if (!geometryMap[topGeoRef]) {
                    geometryMap[topGeoRef] = null; 
                }
            }

            const permutations = jsonData?.["minecraft:block"]?.permutations || [];
            for (const perm of permutations) {
                const permGeoRef = perm.components?.["minecraft:geometry"];
                if (permGeoRef) {
                    blocksData[blockId].geometryRefs.push(permGeoRef);
                    if (!geometryMap[permGeoRef]) {
                        geometryMap[permGeoRef] = null;
                    }
                }
            }
        }
    }

    for (const [blockId, entry] of Object.entries(blocksData)) {
        entry.geometryRefs = [...new Set(entry.geometryRefs)];
        entry.geoJsonMap = {};
        for (const geoRef of entry.geometryRefs) {
            entry.geoJsonMap[geoRef] = geometryMap[geoRef] || null;
        }

        // Debug
        /**console.log(`\n=== Block Debug: ${blockId} ===`);
        console.log("Top-level geometry refs:", entry.geometryRefs);
        const permRefs = entry.blockJson?.["minecraft:block"]?.permutations?.map(p => p.components?.["minecraft:geometry"]);
        console.log("Permutation geometry refs:", permRefs);
        console.log("geoJsonMap keys:", Object.keys(entry.geoJsonMap));**/
    }

    console.log(`\nCollected ${Object.keys(blocksData).length} blocks and ${Object.keys(geometryMap).length} geometries`);
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
