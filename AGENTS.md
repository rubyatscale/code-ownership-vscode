# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## What this project is

A Visual Studio Code extension for [code_ownership](https://github.com/rubyatscale/code_ownership). It shows the owning team for the currently open file and lets developers quickly navigate to ownership configuration.

## Commands

```bash
npm install

# Build (webpack)
npm run build

# Production build
npm run build:prod

# Watch mode
npm run watch

# Run tests
npm test

# Lint
npm run lint

# Auto-fix lint
npm run fix
```

## Architecture

- `src/` — TypeScript source; the extension queries the `code_ownership` Ruby gem (or a language server) to resolve ownership for the active file and displays it in the status bar
- `package.json` — VS Code extension manifest, activation events, contributed commands, and webpack build config
- `webpack.config.js` — bundles the extension for distribution
