const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

async function extract(source, dest) {
  await fs.ensureDir(dest);
  await fs.emptyDir(dest);

  if (source.endsWith('.mcaddon') || source.endsWith('.zip')) {
    const zip = new AdmZip(source);
    zip.extractAllTo(dest, true);
    console.log('Extracted addon zip to:', dest);
  } else {
    await fs.copy(source, dest);
    console.log('Copied addon folder to:', dest);
  }
}

module.exports = { extract };
