#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Function to check and install missing dependencies
function ensureDependencies() {
    const packageJsonPath = path.join(__dirname, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        console.error('package.json not found.');
        process.exit(1);
    }

    const nodeModulesPath = path.join(__dirname, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
        console.log('node_modules not found. Installing dependencies...');
        try {
            execSync('npm install', { stdio: 'inherit', cwd: __dirname });
            console.log('Dependencies installed successfully.');
        } catch (error) {
            console.error('Failed to install dependencies:', error);
            process.exit(1);
        }
    }
}

// Ensure dependencies before running CLI
ensureDependencies();

// Load and run the CLI
const runCLI = require('./src/cli');
runCLI();
