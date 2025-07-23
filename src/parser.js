let blockList = []

// Handles conversion of block models
async function convertBlockModel(bedrockBlockModelJson) {
    let javaBlockModelJson;
    
    

    return javaBlockModelJson;
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

// NOTES
// Generates all files related to custom blocks (excluding walls, pillars, and slabs)
// Handles stairs as well as all blocks with custom geometry
// Due to Bedrock lacking stair geometry and almost all geos can be converted 
// this function will handle the conversion of most geometry related changes.
function generateBlockModel(javaBlockModelJson) {
    
}

// Universal function that generates th item for each custom block
function createBlockItem(javaBlockModelJson) {

}

module.exports = {
    convertBlockModel,
    convertLangFile,
    blockList
};