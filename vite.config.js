import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';

// The SDK's stylesheet declares its font in fonts.css, which Vite would inline (about 290 KB) into the built CSS for
// every embed. The player declares the font at run time instead (src/font.js), and the files travel in dist/fonts/,
// copied from the installed SDK so ILPlayer keeps no second copy.
const fonts = join(dirname(createRequire(import.meta.url).resolve('@interactivelayers/player-sdk/fonts.css')), 'fonts');
const emptyFonts = new URL('./src/no-fonts.css', import.meta.url).pathname;

export default defineConfig({
  resolve: { alias: [{ find: /^\.\/fonts\.css$/, replacement: emptyFonts }] },
  plugins: [{
    name: 'il-sdk-fonts',
    generateBundle() {
      for (const name of ['Montserrat-wght.woff2', 'OFL.txt']) {
        let source;
        try {
          source = readFileSync(join(fonts, name));
        } catch {
          this.error(`The SDK package has no ${join(fonts, name)}; dist/fonts/${name} would be missing and the panels would lose their font.`);
        }
        this.emitFile({ type: 'asset', fileName: 'fonts/' + name, source });
      }
    },
    writeBundle({ dir }) {
      // The font travels as a file. If the SDK ever imports its fonts.css another way, the alias above stops matching and
      // Vite would inline about 290 KB of font data into the CSS of every embed without any error: stop the build instead.
      // (The CSS is checked once written, because Vite emits it after this plugin's generateBundle.)
      if (!existsSync(join(dir, 'fonts', 'Montserrat-wght.woff2'))) this.error('dist/fonts/Montserrat-wght.woff2 was not written; the panels would lose their font.');
      const css = readdirSync(dir).filter((file) => file.endsWith('.css'));
      if (!css.length) this.error('No stylesheet was written, so the font guard cannot check that the font stayed out of it.');
      for (const file of css) {
        const text = readFileSync(join(dir, file), 'utf8');
        if (/@font-face|data:font|font\/woff2/.test(text))
          this.error(`${file} contains a font (${(text.length / 1024).toFixed(0)} KB of CSS). The SDK's fonts.css is no longer aliased to src/no-fonts.css: the import in its player.css changed, update the alias in vite.config.js.`);
      }
      // The font is not bundled code, so the license plugin does not list it; add its notice to the same file.
      appendFileSync(join(dir, 'THIRD-PARTY-NOTICES.md'), '\n## Montserrat (OFL-1.1)\n\n' +
        'Copyright 2024 The Montserrat.Git Project Authors (https://github.com/JulietaUla/Montserrat.git).\n\n' +
        'fonts/Montserrat-wght.woff2 is the variable font from google/fonts (ofl/montserrat/Montserrat[wght].ttf) converted to WOFF2 ' +
        'without changing its contents. It is licensed under the SIL Open Font License 1.1, with no Reserved Font Name; ' +
        'the license is in fonts/OFL.txt.\n');
    },
  }],
  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: 'native-il-player',
      cssFileName: 'native-il-player',
    },
    license: { fileName: 'THIRD-PARTY-NOTICES.md' },
  },
});
