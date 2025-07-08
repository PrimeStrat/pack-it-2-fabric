const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs');
const extractor = require('./extractor');

module.exports = async function runCLI() {
  console.clear();
  console.log(`Welcome to Pack It 2 Fabric`);

    const prompt = inquirer.createPromptModule();

    const answers = await prompt([
    {
        type: 'input',
        name: 'sourcePath',
        message: 'Enter path to .mcaddon file or folder:',
        validate: input => fs.existsSync(input) || 'Path does not exist.',
    },
    ]);

    const sourcePath = answers.sourcePath;

  const extractPath = path.join(__dirname, '../blocks');
  await extractor.extract(sourcePath, extractPath);

  console.log('Extraction complete. Ready for parsing!');
};
