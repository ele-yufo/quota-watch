#!/bin/bash
set -e
echo "Installing quota-watch..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required. Install from https://nodejs.org"
    exit 1
fi

# Install via npm
npm install -g @quota-watch/cli

echo "Installed! Run: quota-watch --help"
