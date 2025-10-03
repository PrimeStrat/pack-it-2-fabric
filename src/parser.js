const path = require('path');
const fs = require('fs-extra');

let blockList = [];
let blockMappingData = [];
let mappingsFile = "block_mappings.chunker.json";

// Handles conversion of block models
async function convertBlockModel(blockEntry, assetsDir, MODID, ver) {
    const javaModelsBlocksDir = path.join(assetsDir, 'models', 'block');
    const javaModelsItemsDir = path.join(assetsDir, 'models', 'item');
    const javaBlockStatesDir = path.join(assetsDir, 'blockstates');
    mappingsFile = path.join(assetsDir, "../../../block_mappings.chunker.json");

    const blockData = blockEntry.blockJson?.["minecraft:block"];
    if (!blockData) return;

    const description = blockData.description || {};
    const components = blockData.components || {};
    const identifier = description.identifier || [];
    const permutations = blockData.permutations || [];
    const traits = description.traits || {};
    const materialInstances = components['minecraft:material_instances'] || {};

    const mainMat = materialInstances["*"] ?? {};

    let blockGenType = "facing"; 

    if (traits?.["minecraft:placement_position"]?.enabled_states?.includes("minecraft:vertical_half") && identifier.includes("slab")) {
        blockGenType = "slab";
    }

    const hasUp = materialInstances["up"]?.texture !== undefined;
    const hasDown = materialInstances["down"]?.texture !== undefined;
    const hasSide = mainMat?.texture !== undefined;
    if (hasUp && hasDown && hasSide && identifier.includes("pillar")) {
        blockGenType = "pillar";
    }

    blockList.push(blockEntry);

    const geometryRef = components['minecraft:geometry'] || blockEntry.geometryRefs?.[0] || null;
    const geoJson = geometryRef ? blockEntry.geoJsonMap?.[geometryRef] || null : null;

    if (geoJson) {
        const geometries = geoJson?.['minecraft:geometry'] ?? [];
        let allSmall = true;    
        let hasThinPlane = false;    
        let allPlanes45 = true;       
        let maxYSpread = 0;
        let isFullColumn = false

        for (const geometry of geometries) {
            for (const bone of geometry.bones ?? []) {
                for (const cube of bone.cubes ?? []) {
                    if (!Array.isArray(cube.size) || !Array.isArray(cube.origin)) continue;
                    const [sx, sy, sz] = cube.size;
                    const [ox, oy, oz] = cube.origin;
                    isFullColumn = (sx >= 3 && sz >= 3 && sy >= 3);

                    maxYSpread = Math.max(maxYSpread, sy);
                    if (sx >= 3 || sy >= 3 || sz >= 3) allSmall = false;
                    if ((sx < 3 || sz < 3) && sy >= 3) hasThinPlane = true;
                    let yRot = 0;
                    if (Array.isArray(cube.rotation)) {
                        yRot = cube.rotation[1] ?? 0;
                    } else if (cube.rotation?.axis === 'y' && typeof cube.rotation.angle === 'number') {
                        yRot = cube.rotation.angle;
                    }

                    if (yRot !== 45 && yRot !== -45) allPlanes45 = false;
                }
            }
        }

        if (maxYSpread < 3) {
            blockGenType = "zeroCol";
        }

        else if (hasThinPlane && allPlanes45) {
            blockGenType = "flower";
        }
    }

    if (geometryRef && geoJson) {
        const entryForGeneration = {
            id: identifier,
            geometryRef,
            geoJson,
            material_instances: materialInstances,
            traits
        };
        await generateBlockModel(entryForGeneration, javaModelsBlocksDir, MODID, ver, blockGenType);
    }

    const blockStatesPermutations = permutations.map(p => ({
        condition: p.condition,
        components: {
            ...p.components,
            'minecraft:geometry': p.components?.['minecraft:geometry'] || geometryRef
        }
    }));

    await generateBlockStates(identifier, blockStatesPermutations, traits, javaBlockStatesDir, MODID, blockGenType);
    await createItem(identifier, javaModelsItemsDir, MODID);
}

async function flushChunkerMapping(){
    fs.writeFileSync(mappingsFile, JSON.stringify(blockMappingData, null, 2));
}

const stateMapper = (key, value) => {
    if (key === "facing") return ["minecraft:cardinal_direction", value];
    if (key === "type") return ["minecraft:vertical_half", value];
    if (key === "axis") {
        if (value === "x") return ["minecraft:facing_direction", "east"];
        if (value === "y") return ["minecraft:facing_direction", "up"];
        if (value === "z") return ["minecraft:facing_direction", "north"];
    }
    if (key === "waterlogged") return ["waterlogged", value === "true"];
    return [key, value];
};

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
async function createItem(identifier, javaModelsItemsDir, MODID) {
    try {
        const itemName = identifier.split(":")[1];
        const filePath = path.join(javaModelsItemsDir, `${itemName}.json`);

        const content = {
            parent: `${MODID}:block/${itemName}`
        };

        await fs.promises.mkdir(javaModelsItemsDir, { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify(content, null, 2), "utf-8");
    } catch (err) {
        console.error(err);
    }
}

// Handle block state generation
async function generateBlockStates(identifier, permutations, traits, javaBlockStatesDir, MODID, blockGenType) {
    const blockName = identifier.split(":")[1];
    const outFile = path.join(javaBlockStatesDir, `${blockName}.json`);
    const variants = {};
    const facingToY = { north: 180, south: 0, west: 90, east: 270 };
    const yRotationOffset = traits?.["minecraft:placement_direction"]?.y_rotation_offset || 0;

    const addVariant = (variantKey, useY = false) => {
        const variant = { model: `${MODID}:block/${blockName}` };
        if (useY) {
            const match = variantKey.match(/facing=(north|south|west|east)/);
            if (match) variant.y = (facingToY[match[1]] + yRotationOffset) % 360;
        }
        variants[variantKey] = variant;
    };

    if (blockGenType === "slab") {
        variants["type=bottom"] = { model: `${MODID}:block/${blockName}` };
        variants["type=top"] = { model: `${MODID}:block/${blockName}_top` };
    } else if (blockGenType === "pillar") {
        variants["axis=x"] = { model: `${MODID}:block/${blockName}`, x: 90, y: 90 };
        variants["axis=y"] = { model: `${MODID}:block/${blockName}` };
        variants["axis=z"] = { model: `${MODID}:block/${blockName}`, x: 90 };
    } else {
        const dirs = ["north", "south", "west", "east"];
        if (!Array.isArray(permutations) || permutations.length === 0 || permutations === "unknown_block") {
            dirs.forEach(d => addVariant(`facing=${d}`, false));
        } else {
            for (const perm of permutations) {
                const match = perm.condition?.match(/q\.block_state\('minecraft:(?:cardinal_direction|facing_direction)'\)\s*==\s*'(\w+)'/);
                if (match) addVariant(`facing=${match[1]}`, true);
            }
            if (Object.keys(variants).length === 0) dirs.forEach(d => addVariant(`facing=${d}`, false));
        }
    }

    const waterloggedStates = ["false", "true"];
    const facings = ["north", "south", "west", "east"];
    const slabTypes = ["bottom", "top"];
    const axes = ["x", "y", "z"];

    const allVariants = [];

    if (blockGenType === "slab") {
        for (const type of slabTypes) {
            for (const water of waterloggedStates) {
                allVariants.push({ type, waterlogged: water });
            }
        }
    } else if (blockGenType === "pillar") {
        for (const axis of axes) {
            allVariants.push({ axis });
        }
    } else {
        for (const facing of facings) {
            allVariants.push({ facing });
        }
    }

    for (const variant of allVariants) {
        const oldStates = variant;
        const newStates = {};
        for (const [k, v] of Object.entries(oldStates)) {
            const [newKey, newValue] = stateMapper(k, v);
            newStates[newKey] = newValue;
        }

        blockMappingData.push({
            old_identifier: identifier,
            new_identifier: identifier,
            old_state_values: oldStates,
            new_state_values: newStates
        });
    }

    const blockStateJson = { variants };
    await fs.mkdir(javaBlockStatesDir, { recursive: true });
    await fs.writeFile(outFile, JSON.stringify(blockStateJson, null, 2));
}

// Geometry converter
async function generateBlockModel(blockEntry, javaModelsBlocksDir, MODID, ver, blockGenType) {
    const blockId = blockEntry.id;
    const blockName = blockId.includes(':') ? blockId.split(':')[1] : blockId;

    const textures = {};
    const materialInstances = blockEntry.material_instances
        || blockEntry.blockJson?.["minecraft:block"]?.components?.["minecraft:material_instances"]
        || {};

    if (materialInstances["*"]?.texture) {
        textures["0"] = `${MODID}:block/${materialInstances["*"].texture}`;
    }
    for (const face of ["up", "down", "north", "south", "east", "west"]) {
        if (materialInstances[face]?.texture) {
            textures[face] = `${MODID}:block/${materialInstances[face].texture}`;
        }
    }

    // Pick the first permutation geometry as the core model
    let coreGeometry = blockEntry.geoJson || null;
    if (blockEntry.geometries && blockEntry.geometries.length > 0) {
        coreGeometry = blockEntry.geometries[0].geometry;
    }

    const blockJson = coreGeometry
        ? await convertBedrockGeometryToJava(
            coreGeometry,
            textures,
            Object.fromEntries(Object.keys(textures).map(k => [k, `#${k}`])),
            blockGenType
        )
        : await getDefaultGeometry(blockName, textures);

    const normalizeToRange = (elements, fromY) => {
        return elements.map(el => {
            const newEl = { ...el };
            const height = el.to[1] - el.from[1];
            newEl.from = [...el.from];
            newEl.to = [...el.to];

            newEl.from[1] = fromY;
            newEl.to[1] = fromY + height;

            // Clamp to valid slab bounds
            if (fromY === 0 && newEl.to[1] > 8) newEl.to[1] = 8;
            if (fromY === 8 && newEl.to[1] > 16) newEl.to[1] = 16;

            return newEl;
        });
    };

    if (blockGenType === "slab") {
        const bottomJson = {
            format_version: ver,
            credit: "Made with PackIt2Fabric",
            parent: "block/cube_all",
            texture_size: blockJson?.texture_size || [16, 16],
            textures,
            elements: normalizeToRange(blockJson?.elements || [], 0),
            groups: blockJson?.groups || []
        };
        const bottomPath = path.join(javaModelsBlocksDir, `${blockName}.json`);
        await fs.promises.mkdir(javaModelsBlocksDir, { recursive: true });
        await fs.promises.writeFile(bottomPath, formatJSONInline(bottomJson, '\t'), 'utf8');

        const topJson = {
            ...bottomJson,
            elements: normalizeToRange(blockJson?.elements || [], 8)
        };
        const topPath = path.join(javaModelsBlocksDir, `${blockName}_top.json`);
        await fs.promises.writeFile(topPath, formatJSONInline(topJson, '\t'), 'utf8');
    } else {
        const finalJson = {
            format_version: ver,
            credit: "Made with PackIt2Fabric",
            parent: "block/cube_all",
            texture_size: blockJson?.texture_size || [16, 16],
            textures,
            elements: blockJson?.elements || [],
            groups: blockJson?.groups || []
        };

        const blockFilePath = path.join(javaModelsBlocksDir, `${blockName}.json`);
        await fs.promises.mkdir(javaModelsBlocksDir, { recursive: true });
        await fs.promises.writeFile(blockFilePath, formatJSONInline(finalJson, '\t'), 'utf8');
    }
}

async function convertBedrockGeometryToJava(bedrockGeometry, textures, faceToKey = {}, blockGenType) {
    if (!bedrockGeometry) return null;

    let vParent = "block/cube_all"

    let geometryObj = null;
    if (Array.isArray(bedrockGeometry['minecraft:geometry'])) {
        geometryObj = bedrockGeometry['minecraft:geometry'].find(g => typeof g.description?.identifier === 'string');
    }
    if (!geometryObj) {
        console.warn("No valid geometry object found:", bedrockGeometry);
        return { parent: vParent, textures, texture_size: [16,16], elements: [], groups: [] };
    }

    // console.log(textures) DEBUG

    const desc = geometryObj.description || {};
    const texW = desc?.texture_width ?? 16;
    const texH = desc?.texture_height ?? 16;

    const uvPxToJava = (u, v) => [(u / texW) * 16, (v / texH) * 16];

    const mapUvBox = (faceDef) => {
        if (!faceDef || !Array.isArray(faceDef.uv) || !Array.isArray(faceDef.uv_size)) return [0,0,16,16];
        let [u,v] = faceDef.uv;
        let [w,h] = faceDef.uv_size;

        let [x1, y1] = uvPxToJava(u, v);
        let [x2, y2] = uvPxToJava(u + w, v + h);

        if (w < 0) [x1, x2] = [x2, x1];
        if (h < 0) [y1, y2] = [y2, y1];

        return [x1, y1, x2, y2];
    };

    function clampJavaAngle(angle) {
        const allowed = [-45, -22.5, 0, 22.5, 45];
        let closest = allowed[0];
        let minDiff = Math.abs(angle - closest);
        for (const val of allowed) {
            const diff = Math.abs(angle - val);
            if (diff < minDiff) { 
                closest = val; minDiff = diff;
            }
        }
        return closest;
    }

    const buildFaces = (cube, faceToKeyLocal = {}, texW = 16, texH = 16) => {
        const faces = {};
        const faceList = ['north','south','east','west','up','down'];
        const defaultSizes = {
            north: [cube.size[0], cube.size[1]],
            south: [cube.size[0], cube.size[1]],
            east: [cube.size[2], cube.size[1]],
            west: [cube.size[2], cube.size[1]],
            up: [cube.size[0], cube.size[2]],
            down: [cube.size[0], cube.size[2]]
        };

        for (const face of faceList) {
            let uvBox;
            const texIndex =
                faceToKeyLocal[face] ||
                (cube.faces && cube.faces[face]?.texture) ||
                faceToKeyLocal['*'] ||
                "#0";

            if (blockGenType === "flower") {
                const baseFace = Object.keys(cube.uv || {})[0] || 'north';
                const baseUv = cube.uv[baseFace];
                const [u,v] = baseUv?.uv || baseUv;
                const [w,h] = defaultSizes[baseFace] || [16,16];
                const mappedUv = mapUvBox({ uv: [u,v], uv_size: [w,h] }, texW, texH);

                if (['north','south','east','west'].includes(face)) {
                    uvBox = mappedUv;
                } else {
                    const def = cube.uv?.[face];
                    if (def) {
                        if (Array.isArray(def.uv) && Array.isArray(def.uv_size)) {
                            uvBox = mapUvBox(def, texW, texH);
                        } else {
                            const [u2, v2] = def.uv || [0, 0];
                            const [w2, h2] = defaultSizes[face];
                            uvBox = mapUvBox({ uv: [u2, v2], uv_size: [w2, h2] }, texW, texH);
                        }
                    } else {
                        uvBox = mappedUv;
                    }
                }
            } else {
                const def = cube.uv[face];
                if (!def) continue;
                if (Array.isArray(def?.uv) && Array.isArray(def?.uv_size)) {
                    uvBox = mapUvBox(def, texW, texH);
                } else {
                    const [u,v] = def?.uv || [0,0];
                    const [w,h] = defaultSizes[face];
                    uvBox = mapUvBox({ uv: [u,v], uv_size: [w,h] }, texW, texH);
                }
            }

            if (face === "up") {
                uvBox = [uvBox[2], uvBox[3], uvBox[0], uvBox[1]];
            } else if (face === "south") {
                uvBox = [uvBox[2], uvBox[1], uvBox[0], uvBox[3]];
            }

            faces[face] = { uv: uvBox, texture: texIndex };
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

    const mergeRotations = (boneRot, cubeRot, cubeOrigin, cubeSize, bonePivot) => {
        const br = boneRot || [0, 0, 0];
        const cr = cubeRot || [0, 0, 0];
        const total = [br[0] + cr[0], br[1] + cr[1], br[2] + cr[2]];

        const axes = ['x', 'y', 'z'];
        let maxIndex = total.reduce(
            (maxIdx, val, idx, arr) => Math.abs(val) > Math.abs(arr[maxIdx]) ? idx : maxIdx,
            0
        );

        let rawAngle = total[maxIndex];
        let clampedAngle = clampJavaAngle(rawAngle);

        let origin;
        if (Math.abs(total[0]) < 1e-6 && Math.abs(total[1]) < 1e-6 && Math.abs(total[2]) < 1e-6) {
            origin = [
                cubeOrigin[0] < 0 ? cubeOrigin[0] + cubeSize[0]/2 : cubeOrigin[0] + cubeSize[0]/2,
                bonePivot?.[1] ?? 0,
                cubeOrigin[2] < 0 ? cubeOrigin[2] + cubeSize[2]/2 : cubeOrigin[2] + cubeSize[2]/2
            ];
        }

        return { axis: axes[maxIndex], angle: clampedAngle, origin };
    };

    const chooseOrigin = (cube, bone, from, to) => {
        if (Array.isArray(cube.pivot)) return cube.pivot.slice(0,3); 
        if (Array.isArray(bone?.pivot)) return bone.pivot.slice(0,3);

        return [
            (from[0] + to[0]) / 2,
            (from[1] + to[1]) / 2,
            (from[2] + to[2]) / 2
        ];
    };

    const shouldConvertCube = (cube, bone, visibleOffset = [0, 0, 0]) => {
        if (cube.pivot) return false;
        if (cube.rotation && cube.rotation.some(r => r !== 0)) return false;

        if (bone.name !== "root") return false;

        const pivot = bone.pivot || [0, 0, 0];
        const minX = cube.origin[0] + pivot[0] + visibleOffset[0];
        const minY = cube.origin[1] + pivot[1] + visibleOffset[1];
        const minZ = cube.origin[2] + pivot[2] + visibleOffset[2];

        const maxX = minX + (cube.size[0] || 0);
        const maxY = minY + (cube.size[1] || 0);
        const maxZ = minZ + (cube.size[2] || 0);

        return minX < 0 || minZ < 0 || minY < 0 || maxX < 0 || maxZ < 0 || maxY < 0;
    };

    const convertOriginSize = (origin, size) => {
        const fromX = origin[0] + Math.abs(Math.min(origin[0], 0));
        const fromY = origin[1];
        const fromZ = origin[2] + Math.abs(Math.min(origin[2], 0));

        const toX = fromX + size[0];
        const toY = fromY + size[1];
        const toZ = fromZ + size[2];

        return { from: [fromX, fromY, fromZ], to: [toX, toY, toZ] };
    };

    const elements = [];
    const groups = [];
    const bones = geometryObj.bones || [];
    let colorCounter = 0;

    for (const bone of bones) {
        const boneRot = Array.isArray(bone.rotation) ? bone.rotation : [0, 0, 0];
        const bonePivot = Array.isArray(bone.pivot) ? bone.pivot.slice(0, 3) : [0, 0, 0];
        const boneChildren = [];

        if (!Array.isArray(bone.cubes)) continue;
        for (const cube of bone.cubes) {
            if (!Array.isArray(cube.origin) || !Array.isArray(cube.size)) continue;
            const [ox, oy, oz] = cube.origin;
            const [sx, sy, sz] = cube.size;
            let from = [ox + 8, oy, oz + 8];
            let to = [ox + sx + 8, oy + sy, oz + sz + 8];

            ({ from, to } = applyInflate(from, to, typeof cube.inflate === 'number' ? cube.inflate : 0));
            [from, to] = epsilonizeIfNeeded(from, to);

            const cubeRot = Array.isArray(cube.rotation) ? cube.rotation : [0, 0, 0];
            const merged = mergeRotations(boneRot, cubeRot, cube.origin, cube.size, bonePivot);
            let origin = merged.origin || chooseOrigin(cube, bone, from, to);

            if (blockGenType == "flower"){
                origin = [to[2], from[1], to[2]]
            }

            const faces = buildFaces(cube, faceToKey, texW, texH);

            const element = {
                name: bone.name || 'cube',
                from,
                to,
                rotation: { angle: merged.angle, axis: merged.axis, origin },
                faces
            };

            elements.push(element);
            boneChildren.push(elements.length - 1);
        }

        groups.push({
            name: bone.name || 'root',
            origin: bonePivot.map((v, i) => i !== 1 ? v + 8 : v),
            color: colorCounter++,
            children: boneChildren
        });
    }

    return { parent: vParent, textures, texture_size: [texW,texH], elements, groups };
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

function formatJSONInline(data, indent = '\t', level = 0, parentKey = '') {
    const pad = indent.repeat(level);

    if (Array.isArray(data)) {
        // Inline if short and primitive values only
        if (data.length <= 6 && data.every(v => typeof v !== 'object')) {
            return `[${data.join(', ')}]`;
        }
        return '[\n' + data.map(v => pad + indent + formatJSONInline(v, indent, level + 1)).join(',\n') + '\n' + pad + ']';
    }

    if (data && typeof data === 'object') {
        const keys = Object.keys(data);

        // Skip collapsing for textures object
        if (parentKey !== 'textures' && keys.length <= 4 && keys.every(k => {
            const v = data[k];
            return typeof v !== 'object' || (Array.isArray(v) && v.length <= 6 && v.every(x => typeof x !== 'object'));
        })) {
            return '{' + keys.map(k => JSON.stringify(k) + ': ' + formatJSONInline(data[k], indent, 0, k)).join(', ') + '}';
        }

        return '{\n' + keys.map(k => pad + indent + JSON.stringify(k) + ': ' + formatJSONInline(data[k], indent, level + 1, k)).join(',\n') + '\n' + pad + '}';
    }

    return JSON.stringify(data);
}

module.exports = {
    convertBlockModel,
    convertLangFile,
    flushChunkerMapping,
    blockList
};