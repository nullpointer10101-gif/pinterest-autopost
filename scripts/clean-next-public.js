const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const generatedTargets = ['_next', 'index.html', 'index.txt', '404.html', 'react-assets'];

for (const target of generatedTargets) {
  const fullPath = path.join(publicDir, target);
  if (!fullPath.startsWith(publicDir)) {
    throw new Error(`Refusing to remove outside public directory: ${fullPath}`);
  }
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

console.log('Cleaned generated public UI export files.');
