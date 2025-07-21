const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs');
const extractor = require('./extractor');
const { generateFabricMod } = require('./generator');

async function runCLI() {
  console.clear();
  console.log(`Welcome to Pack It 2 Fabric!`);

  if (!process.stdin.isTTY) {
    console.error("\nError: This CLI requires an interactive terminal (TTY).\nPlease run it in a normal terminal window.");
    process.exit(1);
  }

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

    // Prompt user to continue with generation (yes/y/no/n)
    const proceedAnswer = await prompt([
      {
        type: 'input',
        name: 'runGenerator',
        message: 'Would you like to generate the Fabric mod now? (yes/y/no/n):',
        validate: input => {
          const val = input.trim().toLowerCase();
          return ['yes', 'y', 'no', 'n'].includes(val) || 'Please enter yes, y, no, or n.';
        }
      }
    ]);

    const proceed = proceedAnswer.runGenerator.trim().toLowerCase();
    if (proceed === 'yes' || proceed === 'y') {
      await generateFabricMod();
      console.log('Generation complete!');
    } else {
      console.log('Generation skipped.');
    }

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
