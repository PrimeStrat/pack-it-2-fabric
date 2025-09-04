const path = require('path');
const fs = require('fs-extra');

let blockList = []

// Handles conversion of block models
async function convertBlockModel(blockEntry, assetsDir, MODID, ver) {
    const javaModelsBlocksDir = path.join(assetsDir, 'models', 'block');
    const javaModelsItemsDir = path.join(assetsDir, 'models', 'item');
    const javaBlockStatesDir = path.join(assetsDir, 'blockstates');

    // console.log(JSON.stringify(blockEntry, null, 2)); DEBUG

    // Access the nested "minecraft:block" object
    const blockData = blockEntry.blockJson?.["minecraft:block"];
    if (!blockData) {
        console.warn("Invalid blockJson structure:", blockEntry.blockJson);
        return;
    }

    const description = blockData.description || {};
    const components = blockData.components || {};

    const identifier = description.identifier || [];
    const geometryRef = components['minecraft:geometry'] || blockEntry.geometryRef || null;
    const geoJson = blockEntry.geoJson || null;

    const permutations = blockData.permutations || 'unknown_block';
    const traits = description.traits || {};

    const entryForGeneration = {
        id: identifier,
        geometryRef,
        geoJson,
        material_instances: components['minecraft:material_instances'] || {}
    };

    if (description.traits) {
        entryForGeneration.traits = description.traits;
    }

    blockList.push(blockEntry);

    if (geometryRef && geoJson) {
        await generateBlockModel(
            entryForGeneration,
            javaModelsBlocksDir,
            MODID,
            ver
        );
        await generateBlockStates(
            identifier,
            permutations,
            traits,
            javaBlockStatesDir,
            MODID
        )
        await createItem(
            identifier,
            javaModelsItemsDir,
            MODID
        )
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

async function generateBlockStates(identifier, perm, traits, javaBlockStatesDir, MODID) {
    const blockName = identifier.split(":")[1];
    const outFile = path.join(javaBlockStatesDir, `${blockName}.json`);

    const variants = {};
    const yOffset = traits?.["minecraft:placement_direction"]?.y_rotation_offset || 0;

    const addVariant = (variantKey, rotationArr) => {
        const rot = bedrockRotationToJava(rotationArr || [], yOffset);
        variants[variantKey] = {
            model: `${MODID}:block/${blockName}`,
            ...(rot.x ? { x: rot.x } : {}),
            ...(rot.y ? { y: rot.y } : {}),
            ...(rot.z ? { z: rot.z } : {})
        };
    };

    if (!Array.isArray(perm) || perm.length === 0 || perm === "unknown_block") {
        // Always create facing variants for cardinal directions
        ["east", "south", "north", "west"].forEach(dir => addVariant(`facing=${dir}`));
    } else {
        for (const p of perm) {
            const conditions = parseCondition(p.condition || "");
            if (!conditions.length) continue;

            const rotationArr = p.components?.["minecraft:transformation"]?.rotation || [];
            const variantParts = [];

            for (const { key, value } of conditions) {
                if (key === "cardinal_direction" || key === "facing_direction") {
                    variantParts.push(`facing=${value}`);
                } else if (key === "block_face") {
                    if (value === "east" || value === "west") variantParts.push("axis=x");
                    else if (value === "up" || value === "down") variantParts.push("axis=y");
                    else if (value === "north" || value === "south") variantParts.push("axis=z");
                } else if (key === "vertical_half") {
                    variantParts.push(`type=${value}`);
                } else if (key === "waterlogged") {
                    variantParts.push(`waterlogged=${value}`);
                }
            }

            const variantKey = variantParts.join(",");
            addVariant(variantKey, rotationArr);
        }

        if (Object.keys(variants).length === 0) {
            ["east", "south", "north", "west"].forEach(dir => addVariant(`facing=${dir}`));
        }
    }

    const blockStateJson = { variants };

    await fs.mkdir(javaBlockStatesDir, { recursive: true });
    await fs.writeFile(outFile, JSON.stringify(blockStateJson, null, 2));
}

// Geometry converter
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
        blockJson = await convertBedrockGeometryToJava(blockEntry.geoJson, textures);
    } else {
        blockJson = await getDefaultGeometry(blockName, textures);
    }

    // Wrap for final format
    const finalJson = {
        format_version: ver,
        credit: "Made with PackIt2Fabric",
        parent: "block/cube_all",
        texture_size: blockJson?.texture_size || [16, 16],
        textures: textures,
        elements: blockJson?.elements || [],
        groups: blockJson?.groups || []
    };

    const blockFilePath = path.join(javaModelsBlocksDir, `${blockName}.json`);
    try {
        await fs.promises.mkdir(javaModelsBlocksDir, { recursive: true });
        const jsonStr = formatJSONInline(finalJson, '\t');
        await fs.promises.writeFile(blockFilePath, jsonStr, 'utf8');
    } catch (err) {
        console.error(`Failed to save block JSON for ${blockName}:`, err);
    }
}

async function convertBedrockGeometryToJava(bedrockGeometry, textures) {
    if (!bedrockGeometry) return null;

    let geometryObj = null;
    if (Array.isArray(bedrockGeometry['minecraft:geometry'])) {
        geometryObj = bedrockGeometry['minecraft:geometry'].find(g => typeof g.description?.identifier === 'string');
    }
    if (!geometryObj) {
        console.warn("No valid geometry object found:", bedrockGeometry);
        return { parent: "block/cube_all", textures, texture_size: [16,16], elements: [], groups: [] };
    }

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

        // Handle negative UVs (flips)
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
                closest = val;
                minDiff = diff;
            }
        }
        return closest;
    }

    const buildFaces = (cube) => {
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
            if (!cube.uv || !cube.uv[face]) continue; // only add if defined
            const def = cube.uv[face];
            let uvBox;
            if (Array.isArray(def.uv) && Array.isArray(def.uv_size)) {
                uvBox = mapUvBox(def);
            } else {
                // use cube-level UV and default face size
                const [u,v] = cube.uv[face]?.uv || cube.uv;
                const [w,h] = defaultSizes[face];
                uvBox = mapUvBox({ uv: [u,v], uv_size: [w,h] });
            }
            faces[face] = { uv: uvBox, texture: "#0" };
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

    const mergeRotations = (boneRot, cubeRot) => {
        const br = boneRot || [0, 0, 0];
        const cr = cubeRot || [0, 0, 0];
        const total = [br[0] + cr[0], br[1] + cr[1], br[2] + cr[2]];

        const axes = ['x', 'y', 'z'];
        let maxIndex = total.reduce(
            (maxIdx, val, idx, arr) => Math.abs(val) > Math.abs(arr[maxIdx]) ? idx : maxIdx,
            0
        );

        let rawAngle = total[maxIndex]; // preserve sign
        let clampedAngle = clampJavaAngle(rawAngle); // second param: keepSign

        // Special case for "no rotation" — force y axis and default origin
        if (Math.abs(total[0]) < 1e-6 && Math.abs(total[1]) < 1e-6 && Math.abs(total[2]) < 1e-6) {
            return { axis: 'y', angle: 0, origin: [8, 0, 8] };
        }

        return { axis: axes[maxIndex], angle: clampedAngle, origin: null };
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
        const boneRot = Array.isArray(bone.rotation) ? bone.rotation : [0, 0, 0];
        const bonePivot = Array.isArray(bone.pivot) ? bone.pivot.slice(0, 3) : [0, 0, 0];
        const boneChildren = [];

        if (!Array.isArray(bone.cubes)) continue;
        for (const cube of bone.cubes) {
            if (!Array.isArray(cube.origin) || !Array.isArray(cube.size)) continue;
            const [ox, oy, oz] = cube.origin;
            const [sx, sy, sz] = cube.size;
            let from = [ox + 8, oy, oz + 8];
            let to   = [ox + sx + 8, oy + sy, oz + sz + 8];

            ({ from, to } = applyInflate(from, to, typeof cube.inflate === 'number' ? cube.inflate : 0));
            [from, to] = epsilonizeIfNeeded(from, to);

            const cubeRot = Array.isArray(cube.rotation) ? cube.rotation : [0, 0, 0];
            const merged = mergeRotations(boneRot, cubeRot);
            const origin = merged.origin || chooseOrigin(cube, bone, from, to);

            // Always include rotation before faces
            const faces = buildFaces(cube);
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

function parseCondition(condition) {
    const matches = [...condition.matchAll(/'minecraft:(.*?)'\)\s*==\s*'(\w+)'/g)];
    return matches.map(([ , key, value ]) => ({ key, value }));
}

function bedrockRotationToJava(rotationArr, yOffset = 0) {
    const [x = 0, y = 0, z = 0] = rotationArr;
    let rot = { x, y, z };
    if (yOffset) {
        rot.y = (rot.y + yOffset) % 360;
        if (rot.y > 180) rot.y -= 360;
    }
    return rot;
}

module.exports = {
    convertBlockModel,
    convertLangFile,
    blockList
};