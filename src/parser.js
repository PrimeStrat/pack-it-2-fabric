let blockList = []

// Handles conversion of block models
async function convertBlockModel(blockEntry, assetsDir, MODID) {
    const javaModelsBlocksDir = path.join(assetsDir, 'models', 'block');
    
    if (!blockEntry?.id) return null;
    blockList.push(blockEntry);

    await generateBlockModel({
        id: blockEntry.id,
        blockJson: blockEntry.blockJson,
        geoJson: blockEntry.geoJson,
        geometryRef: blockEntry.geometryRef,
        material_instances: blockEntry.material_instances,
        traits: blockEntry.traits,
        components: blockEntry.components
    }, javaModelsBlocksDir, MODID);
}


// Handles conversion of lang files
async function convertLangFile(langFileContent) {
    const lines = langFileContent.split('\n');
    const out = {};
    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx === -1) continue;

        let key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();

        if (key.startsWith('tile.')) {
            key = key.replace(/^tile\./, 'block.');
        } else if (key.startsWith('item.')) {
            key = key.replace(/^item\./, 'item.');
        }

        key = key.replace(/:/g, '.').replace(/\.name$/, ''); // UPDATE KEY NAMES

        out[key] = value;
    }
    return out;
}

// Handles conversion of items
async function createItem(bedrockItemJson) {

}

// Generates all files related to custom walls & pillars
function generateWallModel(javaBlockModelJson) {

}

// Generates all files related to custom slabs
function generateSlabModel(javaBlockModelJson) {
    
}

// Universal function that generates th item for each custom block
function createBlockItem(javaBlockModelJson) {

}

// NOTES
// Generates all files related to custom blocks (excluding walls, pillars, and slabs)
// Handles stairs as well as all blocks with custom geometry
// Due to Bedrock lacking stair geometry and almost all geos can be converted 
// this function will handle the conversion of most geometry related changes.
async function generateBlockModel(blockEntry, javaModelsBlocksDir, MODID) {
    if (!blockEntry || !blockEntry.id) return;

    const blockId = blockEntry.id;
    const blockName = blockId.includes(':') ? blockId.split(':')[1] : blockId;

    // Convert Bedrock material_instances to Fabric textures
    const textures = {};
    if (blockEntry.material_instances) {
        const mat = blockEntry.material_instances['*'] || {};
        textures['*'] = mat.texture ? `${MODID}:block/${mat.texture}` : '#*';
        if (mat.up) textures['up'] = `${MODID}:block/${mat.up}`;
        if (mat.down) textures['down'] = `${MODID}:block/${mat.down}`;
        if (mat.north) textures['north'] = `${MODID}:block/${mat.north}`;
        if (mat.south) textures['south'] = `${MODID}:block/${mat.south}`;
        if (mat.east) textures['east'] = `${MODID}:block/${mat.east}`;
        if (mat.west) textures['west'] = `${MODID}:block/${mat.west}`;
    }

    // Start with default geometry
    let blockJson = getDefaultGeometry(blockName, textures);

    // Save the JSON
    const blockFilePath = path.join(javaModelsBlocksDir, `${blockName}.json`);
    try {
        await fs.promises.mkdir(javaModelsBlocksDir, { recursive: true });
        await fs.promises.writeFile(blockFilePath, JSON.stringify(blockJson, null, 2), 'utf8');
        console.log(`Saved block JSON: ${blockFilePath}`);
    } catch (err) {
        console.error(`Failed to save block JSON for ${blockName}:`, err);
    }
}

/**
 * Converts textures object into default Fabric geometry
 * textures: { "*": "wmct:block/... ", "up": "...", "down": "..."}
 */
function getDefaultGeometry(blockName, textures) {
    const elements = [
        {
            name: 'block',
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
                north: { uv: [0, 0, 16, 16], texture: textures['north'] || textures['*'] || '#*' },
                south: { uv: [0, 0, 16, 16], texture: textures['south'] || textures['*'] || '#*' },
                east:  { uv: [0, 0, 16, 16], texture: textures['east']  || textures['*'] || '#*' },
                west:  { uv: [0, 0, 16, 16], texture: textures['west']  || textures['*'] || '#*' },
                up:    { uv: [0, 0, 16, 16], texture: textures['up']    || textures['*'] || '#up' },
                down:  { uv: [0, 0, 16, 16], texture: textures['down']  || textures['*'] || '#down' },
            },
        },
    ];

    const groups = [
        {
            name: 'block',
            origin: [8, 0, 8],
            color: 0,
            children: [0],
        },
    ];

    return { elements, groups };
}

module.exports = {
    convertBlockModel,
    convertLangFile,
    blockList
};