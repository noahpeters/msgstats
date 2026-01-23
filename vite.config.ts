import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import stylex from '@stylexjs/rollup-plugin';

export default defineConfig((env) => {
  const isSsrBuild = (env as { ssrBuild?: boolean }).ssrBuild ?? false;
  return {
    plugins: [
      stylex({
        babelConfig: {
          plugins: [
            [
              '@stylexjs/babel-plugin',
              {
                dev: !isSsrBuild,
                runtimeInjection: true,
                treeshakeCompensation: true,
                unstable_moduleResolution: {
                  type: 'commonjs',
                  rootDir: __dirname,
                },
              },
            ],
          ],
        },
      }),
      react(),
    ],
    ssr: {
      noExternal: ['@stylexjs/stylex'],
    },
    build: {
      outDir: 'dist/client',
    },
    server: {
      port: 5173,
    },
  };
});
