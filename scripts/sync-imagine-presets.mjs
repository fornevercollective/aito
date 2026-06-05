#!/usr/bin/env node
/**
 * Syncs the imagine style presets catalog into aito.
 *
 * Source of truth: /Users/qbit/dev/imagine/style_presets/styles.json
 * (and per-preset prompt.txt / meta.json for future richer integration)
 *
 * Run: npm run sync:imagine-presets
 *
 * This gives aito native support for the full 50+ film emulation, cinematic,
 * lens, and aesthetic presets developed in the sibling `imagine` workspace.
 */

import fs from 'node:fs';
import path from 'node:path';

const IMAGINE_DIR = '/Users/qbit/dev/imagine';
const SRC_STYLES = path.join(IMAGINE_DIR, 'style_presets', 'styles.json');
const OUT_FILE = path.join(process.cwd(), 'src', 'data', 'imagine-presets.json');

function main() {
  if (!fs.existsSync(SRC_STYLES)) {
    console.error(`[sync] Source not found: ${SRC_STYLES}`);
    console.error('  Make sure ~/dev/imagine is cloned and up to date.');
    process.exit(1);
  }

  const src = JSON.parse(fs.readFileSync(SRC_STYLES, 'utf8'));
  const presets = src.presets.map((p) => ({
    slug: p.slug,
    display: p.display,
    category: p.category,
    tags: p.tags || [],
  }));

  const out = {
    _meta: {
      source: SRC_STYLES,
      total: presets.length,
      note: 'Source of truth for aito LUT / film emulation / aesthetic presets. Run `npm run sync:imagine-presets` after updates in the sibling `~/dev/imagine` project. This gives aito full access to the rich catalog of 50+ film stocks, cinema LUTs, anamorphic lenses, Pinterest aesthetics, and edit descriptors maintained in imagine/.',
      generated: new Date().toISOString(),
    },
    presets,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');

  console.log(`[sync] Wrote ${presets.length} presets from imagine → ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log('  Categories:', [...new Set(presets.map(p => p.category))].join(', '));
}

main();
