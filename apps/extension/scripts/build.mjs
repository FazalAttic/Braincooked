import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAllIcons } from './generate-icons.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist');

const isWatch = process.argv.includes('--watch');

async function runBuild() {
  console.log('⚡ Starting Brainroad Extension Build...');
  const startTime = Date.now();

  // 1. Ensure output directory
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 2. Build Popup (SPA)
  console.log('📦 Bundling Popup UI...');
  await build({
    configFile: false,
    root: path.join(rootDir, 'src', 'popup'),
    base: './',
    build: {
      outDir: path.join(outDir, 'popup'),
      emptyOutDir: true,
      watch: isWatch ? {} : null,
      rollupOptions: {
        input: {
          index: path.join(rootDir, 'src', 'popup', 'index.html'),
        },
        output: {
          entryFileNames: 'index.js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'index.[ext]',
        },
      },
    },
  });

  // 3. Build Background Service Worker (ES Module)
  console.log('📦 Bundling Service Worker...');
  await build({
    configFile: false,
    build: {
      outDir: path.join(outDir, 'background'),
      emptyOutDir: false,
      watch: isWatch ? {} : null,
      lib: {
        entry: path.join(rootDir, 'src', 'background', 'index.ts'),
        formats: ['es'],
        fileName: () => 'service-worker.js',
      },
      rollupOptions: {
        output: {
          entryFileNames: 'service-worker.js',
        },
      },
    },
  });

  // 4. Build Content Scripts (Self-Contained IIFE)
  console.log('📦 Bundling Instagram Content Script (IIFE)...');
  await build({
    configFile: false,
    build: {
      outDir: path.join(outDir, 'content'),
      emptyOutDir: false,
      watch: isWatch ? {} : null,
      rollupOptions: {
        input: {
          instagram: path.join(rootDir, 'src', 'content', 'instagram.ts'),
        },
        output: {
          format: 'iife',
          name: 'BrainroadInstagram',
          entryFileNames: 'instagram.js',
        },
      },
    },
  });

  console.log('📦 Bundling YouTube Content Script (IIFE)...');
  await build({
    configFile: false,
    build: {
      outDir: path.join(outDir, 'content'),
      emptyOutDir: false,
      watch: isWatch ? {} : null,
      rollupOptions: {
        input: {
          youtube: path.join(rootDir, 'src', 'content', 'youtube.ts'),
        },
        output: {
          format: 'iife',
          name: 'BrainroadYouTube',
          entryFileNames: 'youtube.js',
        },
      },
    },
  });

  // 5. Synchronize manifest.json
  console.log('📋 Synchronizing manifest.json...');
  const manifestSrc = path.join(rootDir, 'manifest.json');
  const manifestDest = path.join(outDir, 'manifest.json');
  fs.copyFileSync(manifestSrc, manifestDest);

  // 6. Generate and copy icons
  console.log('🎨 Generating and syncing PNG icons...');
  generateAllIcons([
    path.join(rootDir, 'icons'),
    path.join(outDir, 'icons'),
  ]);

  const elapsed = Date.now() - startTime;
  console.log(`✅ Build completed successfully in ${elapsed}ms!`);
  console.log(`📂 Unpacked extension is ready in: ${outDir}`);
}

runBuild().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
