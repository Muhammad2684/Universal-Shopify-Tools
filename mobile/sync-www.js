'use strict';
// Copies templates/accountant_mobile.html -> www/index.html and vendors the
// @capacitor ESM bundles needed for dynamic import() in native (APK) mode.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(__dirname, 'www');

function rmrf(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const s = path.join(from, entry.name);
        const d = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}
function copyFile(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

const srcHtml = path.join(ROOT, 'templates', 'accountant_mobile.html');
if (!fs.existsSync(srcHtml)) {
    console.error(`Missing source template: ${srcHtml}`);
    process.exit(1);
}

rmrf(WWW);
fs.mkdirSync(WWW);
fs.copyFileSync(srcHtml, path.join(WWW, 'index.html'));

copyFile(path.join(__dirname, 'node_modules', '@capacitor', 'core', 'dist', 'index.js'),
         path.join(WWW, 'vendor', 'core', 'index.js'));
copyFile(path.join(__dirname, 'node_modules', '@capacitor', 'synapse', 'dist', 'synapse.mjs'),
         path.join(WWW, 'vendor', 'synapse', 'synapse.mjs'));
copyDir(path.join(__dirname, 'node_modules', '@capacitor', 'share', 'dist', 'esm'),
        path.join(WWW, 'vendor', 'share', 'esm'));
copyDir(path.join(__dirname, 'node_modules', '@capacitor', 'filesystem', 'dist', 'esm'),
        path.join(WWW, 'vendor', 'filesystem', 'esm'));

console.log('synced www/ from templates/accountant_mobile.html + capacitor vendor bundles');