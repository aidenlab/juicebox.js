import fs from 'fs';
import path from 'path';

export function versionPlugin() {
  return {
    name: 'version',
    buildStart() {
      const rootDir = process.cwd();
      
      // Read version from package.json
      const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
      const version = packageJson.version;

      // Update version.js file
      const versionJsPath = path.join(rootDir, 'js', 'version.js');
      fs.writeFileSync(versionJsPath, `const version = "${version}"\nexport {version}\n`, 'utf-8');
      console.log(`✓ Version updated to ${version}`);
    },
  };
}

