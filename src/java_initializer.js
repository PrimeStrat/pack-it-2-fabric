const path = require('path');
const fs = require('fs-extra');
let { blockList } = require('./parser')

async function generateJavaSources(MODID, OUT_DIR, VER) {
    const basePackage = `com.${MODID}`;
    const basePath = path.join(OUT_DIR, 'src', 'main', 'java');

    let initClass = generateModInitializer(MODID, basePackage)
    await writeJavaFile(basePath, basePackage, MODID.toUpperCase(), initClass)

    let clientClass = generateModClient(MODID, basePackage)
    await writeJavaFile(basePath, basePackage, `${MODID.toUpperCase()}Client`, clientClass)

    let { ModItems, ModItemGroups } = generateItemHandler(MODID, basePackage)
    await writeJavaFile(basePath, `${basePackage}.item`, `ModItems`, ModItems)
    await writeJavaFile(basePath, `${basePackage}.item`, `ModItemGroups`, ModItemGroups)

    let { ModBlocks, ModBlockModel, ModSlabBlock } = generateBlockHandler(MODID, basePackage, blockList)
    await writeJavaFile(basePath, `${basePackage}.block`, `ModBlocks`, ModBlocks)
    await writeJavaFile(basePath, `${basePackage}.block`, `ModBlockModel`, ModBlockModel)
    await writeJavaFile(basePath, `${basePackage}.block`, `ModSlabModel`, ModSlabBlock)

    let blockListJavaFile = generateBlockListJavaFile(blockList);
    await writeJavaFile(basePath, `${basePackage}.block`, `ModBlockList`, blockListJavaFile);

    let blockDataJavaFile = generateBlockDataJavaFile();
    await writeJavaFile(basePath, `${basePackage}.block`, `BlockData`, blockDataJavaFile);


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

async function writeBuildGradle(MODID, basePackage, OUT_DIR, VER = '1.20.1') {
    const yarnMappings = '1.20.1+build.10';
    const loaderVersion = '0.15.0';
    const fabricApiVersion = '0.91.0+1.20.1';
    const gradleContent = `
plugins {
    id 'fabric-loom' version '1.5.4'
    id 'java'
}

group = '${basePackage}'
version = '1.0.0'

repositories {
    mavenCentral()
    maven { url "https://maven.tomalbrc.de" }
    //maven { url 'https://maven.fabricmc.net/' }
}

fabricApi {
    configureDataGeneration()
}

dependencies {
    minecraft 'com.mojang:minecraft:${VER}'
    mappings 'net.fabricmc:yarn:${yarnMappings}:v2'
    modImplementation 'net.fabricmc:fabric-loader:${loaderVersion}'
    modImplementation 'net.fabricmc.fabric-api:fabric-api:${fabricApiVersion}'
}

def dataOutput = 'src/main/generated'

sourceSets {
    main {
        java {
            srcDirs = ['src/main/java']
        }
        resources {
            srcDirs = ['src/main/resources', 'src/main/generated']
        }
    }
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = 17
}

java {
    withSourcesJar()

    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

jar {
    from sourceSets.main.output
}

task printSourceSets {
    doLast {
        println "Java source dirs: " + sourceSets.main.java.srcDirs
        println "Resource dirs: " + sourceSets.main.resources.srcDirs
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
import ${basePackage}.block.BlockData;
import ${basePackage}.block.ModBlockList;
import ${basePackage}.block.ModBlocks;
import ${basePackage}.item.ModItems;
import ${basePackage}.item.ModItemGroups;
import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

public class ${MODID.toUpperCase()} implements ModInitializer {

    public static final String MOD_ID = "${MODID}";
    public static final Logger LOGGER = LoggerFactory.getLogger("${MODID}");

    @Override
    public void onInitialize() {
        List<BlockData> blocks = ModBlockList.BLOCK_LIST;
        ModItems.registerModItems();
        ModItemGroups.registerItemGroups();
        if (blocks != null && !blocks.isEmpty()) {
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
import ${basePackage}.block.ModBlockList;
import ${basePackage}.block.BlockData;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.blockrenderlayer.v1.BlockRenderLayerMap;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.block.Block;

public class ${MODID.toUpperCase()}Client implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        int size = Math.min(ModBlockList.BLOCK_LIST.size(), ModBlocks.WMCT_BLOCKS.size());

        for (int i = 0; i < size; i++) {
            BlockData data = ModBlockList.BLOCK_LIST.get(i);
            Block block = ModBlocks.WMCT_BLOCKS.get(i);

            String method = data.getRenderMethod();
            if (method == null) method = "solid"; // default

            switch (method) {
                case "blend":
                    BlockRenderLayerMap.INSTANCE.putBlock(block, RenderLayer.getTranslucent());
                    break;
                case "alpha_test":
                    BlockRenderLayerMap.INSTANCE.putBlock(block, RenderLayer.getCutout());
                    break;
                default:
                    BlockRenderLayerMap.INSTANCE.putBlock(block, RenderLayer.getSolid());
                    break;
            }
        }
    }
}`
}

/**
 * 
 * @param { String } MODID 
 * @param { String } basePackage 
 * @returns {{ ModItems: string, ModItemGroups: string }}
 */
function generateItemHandler(MODID, basePackage) {

    const upper = MODID.toUpperCase();

    const modItems = `
import ${basePackage}.${upper};
import net.fabricmc.fabric.api.itemgroup.v1.FabricItemGroupEntries;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroups;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModItems {

    private static void addItemsToIngredientItemGroup(FabricItemGroupEntries entries) {
    }
    private static Item registerItem(String name, Item item) {
        return Registry.register(Registries.ITEM, new Identifier(${upper}.MOD_ID, name), item);
    }

    public static void registerModItems() {
        ${upper}.LOGGER.info("Registering Mod Items for " + ${upper}.MOD_ID);

        ItemGroupEvents.modifyEntriesEvent(ItemGroups.INGREDIENTS).register(ModItems::addItemsToIngredientItemGroup);
    }
}
`.trim();

    const modItemGroups = `
import ${basePackage}.${upper};
import ${basePackage}.item.ModItems;
import ${basePackage}.block.ModBlocks;
import net.fabricmc.fabric.api.itemgroup.v1.FabricItemGroup;
import net.minecraft.item.ItemGroup;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

public class ModItemGroups {

    public static ItemGroup ${upper}_GROUP;

    public static void registerItemGroups() {
        ${upper}.LOGGER.info("Registering Item Groups for " + ${upper}.MOD_ID);
        ${upper}_GROUP = Registry.register(Registries.ITEM_GROUP,
            new Identifier(${upper}.MOD_ID, "${MODID}"),
            FabricItemGroup.builder().displayName(Text.translatable("${upper}"))
                            .icon(() -> new ItemStack(ModBlocks.${upper}_BLOCKS.get(0))).entries((displayContext, entries) -> {
                                for(int i = 0; i < ModBlocks.${upper}_BLOCKS.size(); i++) {
                                    entries.add(ModBlocks.${upper}_BLOCKS.get(i));
                                }
                            }).build());
    }
}
`.trim();

    return {
        ModItems: modItems,
        ModItemGroups: modItemGroups
    };
}

/**
 * 
 * @param { String } MODID 
 * @param { String } basePackage 
 * @returns {{ ModBlocks: string, ModBlockModel: string, ModSlabBlock: string }}
 */
function generateBlockHandler(MODID, basePackage) {

    const upper = MODID.toUpperCase();

    const modBlocks = `
import ${basePackage}.${upper};
import net.fabricmc.fabric.api.item.v1.FabricItemSettings;
import net.fabricmc.fabric.api.object.builder.v1.block.FabricBlockSettings;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

import java.util.ArrayList;
import java.util.List;

public class ModBlocks {
    public static final List<Block> ${upper}_BLOCKS = new ArrayList<>();

    public static Block loadBlock(BlockData data) {
        FabricBlockSettings settings = FabricBlockSettings.copyOf(Blocks.STONE);

        if (data.getLightEmission() > 0) {
            settings.luminance(state -> data.getLightEmission());
        }

        settings.nonOpaque();
        settings.noBlockBreakParticles();

        Block block;

        if (data.getId().contains("slab")) {
            block = new ModSlabBlock(settings);
        } else {
            block = new ModBlockModel(settings);
        }

        return registerBlock(data.getId(), block);
    }

    private static Block registerBlock(String name, Block block) {
        registerBlockItem(name, block);
        return Registry.register(Registries.BLOCK, new Identifier(${upper}.MOD_ID, name), block);
    }

    private static Item registerBlockItem(String name, Block block) {
        return Registry.register(
            Registries.ITEM,
            new Identifier(${upper}.MOD_ID, name),
            new BlockItem(block, new FabricItemSettings())
        );
    }

    public static void registerModBlocks(List<BlockData> blocks) {
        ${upper}.LOGGER.info("Registering ModBlocks from " + ${upper}.MOD_ID);
        blocks.forEach(data -> ${upper}_BLOCKS.add(loadBlock(data)));
    }
}
`.trim();

    const modBlockModel = `
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.FacingBlock;
import net.minecraft.item.ItemPlacementContext;
import net.minecraft.state.StateManager;
import net.minecraft.state.property.DirectionProperty;
import net.minecraft.state.property.Properties;
import net.minecraft.util.BlockMirror;
import net.minecraft.util.BlockRotation;
import net.minecraft.util.math.Direction;

public class ModBlockModel extends FacingBlock {

    public static final DirectionProperty FACING = Properties.HORIZONTAL_FACING;

    public ModBlockModel(Settings settings) {
        super(settings);
        this.setDefaultState(this.stateManager.getDefaultState().with(FACING, Direction.NORTH));
    }

    @Override
    public BlockState getPlacementState(ItemPlacementContext ctx) {
        return this.getDefaultState().with(FACING, ctx.getHorizontalPlayerFacing().getOpposite());
    }

    @Override
    public BlockState rotate(BlockState state, BlockRotation rotation) {
        return state.with(FACING, rotation.rotate(state.get(FACING)));
    }

    @Override
    public BlockState mirror(BlockState state, BlockMirror mirror) {
        return state.rotate(mirror.getRotation(state.get(FACING)));
    }

    @Override
    protected void appendProperties(StateManager.Builder<Block, BlockState> builder) {
        builder.add(FACING);
    }
}
`.trim();

    const modSlabBlock = `
import net.minecraft.block.BlockState;
import net.minecraft.block.SlabBlock;
import net.minecraft.item.ItemPlacementContext;
import net.minecraft.util.math.Direction;

public class ModSlabBlock extends SlabBlock {
    public ModSlabBlock(Settings settings) {
        super(settings);
    }

    @Override
    public BlockState getPlacementState(ItemPlacementContext ctx) {
        BlockState state = this.getDefaultState();
        Direction side = ctx.getSide();
        double hitY = ctx.getHitPos().y - (double) ctx.getBlockPos().getY();

        if (side == Direction.DOWN || (side != Direction.UP && hitY > 0.5)) {
            return state.with(TYPE, SlabType.TOP);
        } else {
            return state.with(TYPE, SlabType.BOTTOM);
        }
    }
}
`.trim();

    return {
        ModBlocks: modBlocks,
        ModBlockModel: modBlockModel,
        ModSlabBlock: modSlabBlock
    };
}

/**
 * Generate ModBlockList.java that references BlockData.
 */
function generateBlockListJavaFile(blockEntries) {
    const serializedBlocks = blockEntries.map(entry => {
        let id = entry.id ?? entry.blockJson?.["minecraft:block"]?.description?.identifier ?? "unknown";
        if (id.includes(":")) {
            id = id.split(":")[1];
        }

        const components = entry.blockJson?.["minecraft:block"]?.components ?? {};

        const lightDamp = components["minecraft:light_dampening"] ?? 0;
        const lightEmit = components["minecraft:light_emission"] ?? 0;

        const materialInstances = components["minecraft:material_instances"] ?? {};
        const mainMat = materialInstances["*"] ?? {};

        const texture = mainMat.texture !== undefined ? `"${mainMat.texture}"` : "null";
        const renderMethod = mainMat.render_method !== undefined ? `"${mainMat.render_method}"` : "null";
        const ambientOcclusion = mainMat.ambient_occlusion ?? false;
        const faceDimming = mainMat.face_dimming ?? false;

        return `        new BlockData(
            "${id}",
            ${lightDamp},
            ${lightEmit},
            ${texture},
            ${renderMethod},
            ${ambientOcclusion},
            ${faceDimming}
        )`;
    }).join(",\n");

    return `
import java.util.List;
import java.util.Arrays;

/**
 * Auto-generated block list with selected Bedrock block data.
 * Missing values are set to null or default.
 */
public class ModBlockList {
    public static final List<BlockData> BLOCK_LIST = Arrays.asList(
${serializedBlocks}
    );
}
`.trim();
}

/**
 * Generate BlockData.java as its own file.
 */
function generateBlockDataJavaFile() {
    return `

/**
 * Container class for storing key Bedrock block data inside Java.
 */
public class BlockData {
    private final String id;
    private final int lightDampening;
    private final int lightEmission;
    private final String texture;
    private final String renderMethod;
    private final boolean ambientOcclusion;
    private final boolean faceDimming;

    public BlockData(String id, int lightDampening, int lightEmission,
                     String texture, String renderMethod,
                     boolean ambientOcclusion, boolean faceDimming) {
        this.id = id;
        this.lightDampening = lightDampening;
        this.lightEmission = lightEmission;
        this.texture = texture;
        this.renderMethod = renderMethod;
        this.ambientOcclusion = ambientOcclusion;
        this.faceDimming = faceDimming;
    }

    public String getId() { return id; }
    public int getLightDampening() { return lightDampening; }
    public int getLightEmission() { return lightEmission; }
    public String getTexture() { return texture; }
    public String getRenderMethod() { return renderMethod; }
    public boolean hasAmbientOcclusion() { return ambientOcclusion; }
    public boolean hasFaceDimming() { return faceDimming; }
}
`.trim();
}

module.exports = {
    generateBlockListJavaFile, generateJavaSources
};

