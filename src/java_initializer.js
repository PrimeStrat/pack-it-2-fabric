const path = require('path');
const fs = require('fs-extra');
const { write } = require('fs');

async function generateJavaSources(MODID, OUT_DIR, VER) {
    const basePackage = `com.${MODID}`;
    const basePath = path.join(OUT_DIR, 'src', 'main', 'java');

    let initClass = generateModInitializer(MODID, basePackage)
    await writeJavaFile(basePath, basePackage, MODID, initClass)

    let clientClass = generateModClient(MODID, basePackage)
    await writeJavaFile(basePath, basePackage, `${MODID}Client`, clientClass)

    await writeBuildGradle(MODID, basePackage, OUT_DIR, VER)
}

async function writeJavaFile(basePath, fullPackage, name, content) {
    const packagePath = path.join(basePath, ...fullPackage.split('.'));
    await fs.ensureDir(packagePath);

    const classContent = `package ${fullPackage};

${content}
`.trimStart();

    const filePath = path.join(packagePath, `${name}.java`);
    await fs.writeFile(filePath, classContent);
}

async function writeBuildGradle(MODID, basePackage, OUT_DIR, VER) {
    const mcVersion = VER || '1.20.1';
    const loaderVersion = '0.14.21';
    const gradleContent = `
plugins {
    id 'fabric-loom' version '1.5.4'
    id 'java'
}

group = '${basePackage}'
version = '1.0.0'

repositories {
    mavenCentral()
    maven { url 'https://maven.fabricmc.net/' }
}

dependencies {
    minecraft 'com.mojang:minecraft:${mcVersion}'
    mappings 'net.fabricmc:yarn:${mcVersion}+build.1:v2'
    modImplementation 'net.fabricmc:fabric-loader:${loaderVersion}'
}

sourceCompatibility = JavaVersion.VERSION_17
targetCompatibility = JavaVersion.VERSION_17

jar {
    from('LICENSE') {
        rename { "LICENSE_${MODID}" }
    }
    manifest {
        attributes(
            'Specification-Title': '${MODID}',
            'Specification-Vendor': 'example',
            'Specification-Version': '1',
            'Implementation-Title': '${MODID}',
            'Implementation-Version': project.version,
            'Implementation-Vendor': 'example',
            'Implementation-Timestamp': new Date().format("yyyy-MM-dd'T'HH:mm:ssZ")
        )
    }
}
`;

    await fs.writeFile(path.join(OUT_DIR, 'build.gradle'), gradleContent);
}

/**
 * 
 * @param { String } MODID 
 * @param { String } basePackage 
 * @returns 
 */
function generateModInitializer(MODID, basePackage) {
    return `
import ${basePackage}.bedrock.BlockTransfers;
import ${basePackage}.block.ModBlocks;
import ${basePackage}.item.ModItems;
import ${basePackage}.item.ModItemsGroups;
import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

public class ${MODID.toUpperCase()} implements ModInitializer {

    public static final String MOD_ID = "${MODID}";
    public static final Logger LOGGER = LoggerFactory.getLogger("${MODID}");

    @Override
    public void onInitialize() {
        List<String> blocks = BlockTransfers.blockIDs;
        ModItems.registerModItems();
        ModItemsGroups.registerItemGroups();
        if (blocks != null) {
            ModBlocks.registerModBlocks(blocks);
        }
    }
}`
}

/**
 * 
 * @param { String } MODID 
 * @param { String } basePackage 
 * @returns 
 */
function generateModClient(MODID, basePackage) {
    return `
import ${basePackage}.block.ModBlocks;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.blockrenderlayer.v1.BlockRenderLayerMap;
import net.minecraft.client.render.RenderLayer;

public class WMCTClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ModBlocks.WMCT_BLOCKS.forEach(block -> {
            BlockRenderLayerMap.INSTANCE.putBlock(block, RenderLayer.getTranslucent());
        });
    }
}`
}

module.exports = {
    generateJavaSources
};
