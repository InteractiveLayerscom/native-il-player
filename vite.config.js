import { defineConfig } from 'vite';

export default defineConfig({
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
