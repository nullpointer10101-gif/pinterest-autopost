const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'out');
const publicDir = path.join(root, 'public');

const removeTargets = ['_next', 'index.html', 'index.txt', '404.html', 'react-assets'];

if (!fs.existsSync(outDir)) {
  throw new Error('Next export output folder was not found.');
}

fs.mkdirSync(publicDir, { recursive: true });

for (const target of removeTargets) {
  const fullPath = path.join(publicDir, target);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

const copyRecursive = (source, destination) => {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  fs.copyFileSync(source, destination);
};

for (const entry of fs.readdirSync(outDir)) {
  copyRecursive(path.join(outDir, entry), path.join(publicDir, entry));
}

console.log(`Copied Next export to ${publicDir}`);
