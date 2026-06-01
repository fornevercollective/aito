// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://fornevercollective.github.io',
  base: process.env.ASTRO_BASE || '/aito',
  output: 'static',
});
