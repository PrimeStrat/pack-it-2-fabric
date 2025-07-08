const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs');
const extractor = require('./extractor');

async function runCLI() {
  console.clear();
  console.log(`Welcome to Pack It 2 Fabric!`);

  const prompt = inquirer.createPromptModule();

  try {
    const answers = await prompt([
      {
        type: 'input',
        name: 'sourcePath',
        message: 'Enter path to .mcaddon file or folder:',
        filter: input => input.trim().replace(/^["']|["']$/g, ''),  // Strip surrounding quotes
        validate: input => {
          const cleanInput = input.trim().replace(/^["']|["']$/g, '');
          return fs.existsSync(cleanInput) || 'Path does not exist.';
        },
      },
    ]);

    const sourcePath = answers.sourcePath;
    const extractPath = path.join(__dirname, '../addonAssets');

    await extractor.extract(sourcePath, extractPath);

    console.log('Extraction complete. Ready for parsing!');
  } catch (err) {
    if (err.isTtyError) {
      console.error('Prompt couldn’t be rendered in the current environment.');
    } else if (err.message === 'Cancelled') {
      console.log('\nOperation cancelled by user.');
    } else {
      console.error('\nAn error occurred:', err.message);
    }
    process.exit(1);
  }
}

// Handle Ctrl+C (SIGINT)
process.on('SIGINT', () => {
  console.log('\nInterrupted. Exiting gracefully.');
  process.exit(0);
});

module.exports = runCLI;
