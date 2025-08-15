const path = require('path');
const fs = require('fs-extra');

let blockList = []

// Handles conversion of block models
async function convertBlockModel(blockEntry, assetsDir, MODID, ver) {
    const javaModelsBlocksDir = path.join(assetsDir, 'models', 'block');
    const javaModelsItemsDir = path.join(assetsDir, 'models', 'item');
    const texturesDir = path.join(assetsDir, 'textures');

    // Access the nested "minecraft:block" object
    const blockData = blockEntry.blockJson?.["minecraft:block"];
    if (!blockData) {
        console.warn("Invalid blockJson structure:", blockEntry.blockJson);
        return;
    }

    const description = blockData.description || {};
    const components = blockData.components || {};

    const identifier = description.identifier || 'unknown_block';
    const geometryRef = components['minecraft:geometry'] || blockEntry.geometryRef || null;
    const geoJson = blockEntry.geoJson || null;

    const entryForGeneration = {
        id: identifier,
        blockData,
        geometryRef,
        geoJson,
        material_instances: components['minecraft:material_instances'] || {}
    };

    if (description.traits) {
        entryForGeneration.traits = description.traits;
    }

    blockList.push(entryForGeneration);

    if (geometryRef && geoJson) {
        await generateBlockModel(
            entryForGeneration,
            javaModelsBlocksDir,
            MODID,
            ver
        );
    }
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
async function generateBlockModel(blockEntry, javaModelsBlocksDir, MODID, ver) {
    const blockId = blockEntry.id;
    const blockName = blockId.includes(':') ? blockId.split(':')[1] : blockId;

    // Prepare textures
    const textures = {};
    let textureIndex = 0;
    if (blockEntry.material_instances) {
        const mat = blockEntry.material_instances['*'] || {};
        if (mat.texture) textures[`${textureIndex}`] = `${MODID}:block/${mat.texture}`;
        for (const face of ['up', 'down', 'north', 'south', 'east', 'west']) {
            if (mat[face]) {
                textures[`${textureIndex}`] = `${MODID}:block/${mat[face]}`;
            }
        }
    }

    // Convert geometry
    let blockJson;
    if (blockEntry.geoJson && blockEntry.geometryRef) {
        blockJson = await convertBedrockGeometryToJava(blockEntry.blockData, blockEntry.geoJson, textures);
    } else {
        blockJson = await getDefaultGeometry(blockName, textures);
    }

    // Wrap for final format
    const finalJson = {
        format_version: ver,
        credit: "Made with PackIt2Fabric",
        texture_size: blockJson?.texture_size || [16, 16],
        textures: textures,
        elements: blockJson?.elements || [],
        groups: blockJson?.groups || []
    };

    const blockFilePath = path.join(javaModelsBlocksDir, `${blockName}.json`);
    try {
        await fs.promises.mkdir(javaModelsBlocksDir, { recursive: true });
        await fs.promises.writeFile(
            blockFilePath, 
            JSON.stringify(finalJson, null, '\t'), // use a tab for indentation
            'utf8'
        );
    } catch (err) {
        console.error(`Failed to save block JSON for ${blockName}:`, err);
    }
}

async function convertBedrockGeometryToJava(blockData, bedrockGeometry, textures) {
    if (!bedrockGeometry) return null;

    let geometryObj = null;
    if (Array.isArray(bedrockGeometry['minecraft:geometry'])) {
        geometryObj = bedrockGeometry['minecraft:geometry'].find(g => typeof g.description?.identifier === 'string');
    }
    if (!geometryObj) {
        console.warn("No valid geometry object found:", bedrockGeometry);
        return { parent: "block/cube_all", textures, texture_size: [16,16], elements: [], groups: [] };
    }

    const desc = blockData?.description || {};
    const texW = desc?.texture_width ?? 16;
    const texH = desc?.texture_height ?? 16;

    console.log(blockData?.description)

    // CURRENT BUGS
    // UVS ARE INCORRECT
    // ROTATIONS SHOULD ALWAYS SHOW
    // ADDS UNNEEDED FACES?

    // CURRENT OUTPUT

    /*{
   "name": "root",
   "from": [
    0,
    16.25,
    0
   ],
   "to": [
    16,
    16.25,
    16
   ],
   "faces": {
    "up": {
     "uv": [
      0,
      0,
      16,
      16
     ],
     "texture": "#0"
    },
    "down": {
     "uv": [
      0,
      0,
      16,
      16
     ],
     "texture": "#0"
    }
   }
  },
  {
   "name": "root",
   "from": [
    5,
    16.25,
    16
   ],
   "to": [
    11,
    17.25,
    16
   ],
   "faces": {
    "north": {
     "uv": [
      7,
      11,
      8,
      12
     ],
     "texture": "#0"
    },
    "south": {
     "uv": [
      0,
      0,
      16,
      16
     ],
     "texture": "#0"
    }
   }
  }*/

    // INTENDED OUTPUT
    /*{
			"name": "root",
			"from": [0, 16.25, 0],
			"to": [16, 16.25, 16],
			"rotation": {"angle": 0, "axis": "y", "origin": [8, 0, 8]},
			"faces": {
				"up": {"uv": [0, 0, 8, 8], "texture": "#0"}
			}
		},
		{
			"name": "root",
			"from": [5, 16.25, 16],
			"to": [11, 17.25, 16],
			"rotation": {"angle": 0, "axis": "y", "origin": [8, 0, 8]},
			"faces": {
				"north": {"uv": [3.5, 5.5, 4, 6], "texture": "#0"}
			}
		}*/
    const uvPxToJava = (u, v) => [(u / texW) * 16, (v / texH) * 16];

    const mapUvBox = (faceDef) => {
        if (!faceDef || !Array.isArray(faceDef.uv) || !Array.isArray(faceDef.uv_size)) return [0,0,16,16];
        let [u,v] = faceDef.uv;
        let [w,h] = faceDef.uv_size;

        let [x1, y1] = uvPxToJava(u, v);
        let [x2, y2] = uvPxToJava(u + w, v + h);

        // Handle negative UVs (flips)
        if (w < 0) [x1, x2] = [x2, x1];
        if (h < 0) [y1, y2] = [y2, y1];

        return [x1, y1, x2, y2];
    };

    const clampJavaAngle = (ang) => {
        const allowed = [-45, -22.5, 0, 22.5, 45];
        let best=0, bestErr=Infinity;
        for (const a of allowed) { const e=Math.abs(a-ang); if(e<bestErr){bestErr=e;best=a;} }
        return best;
    };

    const buildFaces = (cube) => {
        const uv = cube.uv || {};
        const faces = {};
        const faceList = ['north','south','east','west','up','down'];
        const [sx,sy,sz] = cube.size || [0,0,0];

        for (const face of faceList) {
            if (sx===0 && !['east','west'].includes(face)) continue;
            if (sy===0 && !['up','down'].includes(face)) continue;
            if (sz===0 && !['north','south'].includes(face)) continue;

            const def = uv[face];
            const uvBox = mapUvBox(def);
            // always use numeric texture #0
            const texRef = '#0';
            faces[face] = { uv: uvBox, texture: texRef };
        }
        return faces;
    };

    const applyInflate = (from,to,inflate=0) => {
        if (!inflate) return { from,to };
        return { from:[from[0]-inflate, from[1]-inflate, from[2]-inflate], to:[to[0]+inflate,to[1]+inflate,to[2]+inflate] };
    };

    const epsilonizeIfNeeded = (from,to) => {
        const eps = 0;
        const fix = i => Math.abs(to[i]-from[i])<1e-9 ? (to[i]>=from[i]?to[i]+eps:to[i]-eps) : to[i];
        return [from,[fix(0),fix(1),fix(2)]];
    };

    const mergeRotations = (boneRot,cubeRot) => {
        const br = boneRot||[0,0,0], cr = cubeRot||[0,0,0];
        const total = [br[0]+cr[0], br[1]+cr[1], br[2]+cr[2]];
        const nz = total.map((v,i)=>({axis:['x','y','z'][i],v})).filter(o=>Math.abs(o.v)>1e-6);
        if(nz.length===0) return null;
        if(nz.length>1){console.warn(`Multi-axis rotation ${JSON.stringify(total)} cannot be represented on a single Java element.`); return {axis:null,angle:0};}
        return {axis:nz[0].axis, angle:clampJavaAngle(nz[0].v)};
    };

    const chooseOrigin = (cube, bone, from, to) => {
        if (Array.isArray(cube.pivot)) return cube.pivot.slice(0,3).map((v,i)=>i!==1?v+8:v);
        if (Array.isArray(bone?.pivot)) return bone.pivot.slice(0,3).map((v,i)=>i!==1?v+8:v);
        return [(from[0]+to[0])/2,(from[1]+to[1])/2,(from[2]+to[2])/2];
    };

    const elements = [];
    const groups = [];
    const bones = geometryObj.bones || [];
    let colorCounter = 0; // increment per group

    for (const bone of bones) {
        const boneRot = Array.isArray(bone.rotation)?bone.rotation:[0,0,0];
        const bonePivot = Array.isArray(bone.pivot)?bone.pivot.slice(0,3):[0,0,0];
        const boneChildren = [];

        if(!Array.isArray(bone.cubes)) continue;
        for(const cube of bone.cubes){
            if(!Array.isArray(cube.origin)||!Array.isArray(cube.size)) continue;
            const [ox,oy,oz] = cube.origin;
            const [sx,sy,sz] = cube.size;
            let from = [ox+8, oy, oz+8];
            let to   = [ox+sx+8, oy+sy, oz+sz+8];

            ({from,to} = applyInflate(from,to,typeof cube.inflate==='number'?cube.inflate:0));
            [from,to] = epsilonizeIfNeeded(from,to);

            const faces = buildFaces(cube);
            const cubeRot = Array.isArray(cube.rotation)?cube.rotation:[0,0,0];
            const merged = mergeRotations(boneRot,cubeRot);

            const element = { name: bone.name||'cube', from, to, faces };
            const origin = chooseOrigin(cube,bone,from,to);

            if(merged && merged.axis && Math.abs(merged.angle)>1e-6){
                element.rotation = { angle: merged.angle, axis: merged.axis, origin };
            }

            elements.push(element);
            boneChildren.push(elements.length-1);
        }

        groups.push({ name: bone.name||'root', origin: bonePivot.map((v,i)=>i!==1?v+8:v), color: colorCounter++, children: boneChildren });
    }

    return { parent: "block/cube_all", textures, texture_size: [texW,texH], elements, groups };
}

async function getDefaultGeometry(textures) {
    const elements = [
        {
            name: "root",
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
            name: "root",
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