/**
 * Build: monta a pasta `dist/` que a pipeline publica no GitHub Pages.
 *
 * Junta os arquivos estáticos de `public/` com os módulos de `src/` que a
 * página importa, tudo num diretório plano.
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'dist');

/** Módulos que a página carrega no navegador. */
const MODULOS = ['jogo.js', 'ui.js'];

async function construir() {
  await rm(destino, { recursive: true, force: true });
  await mkdir(destino, { recursive: true });

  await cp(join(raiz, 'public'), destino, { recursive: true });

  for (const arquivo of MODULOS) {
    await cp(join(raiz, 'src', arquivo), join(destino, arquivo));
  }

  const gerados = (await readdir(destino)).sort();
  console.log(`Build concluido em dist/ (${gerados.length} arquivos):`);
  for (const arquivo of gerados) {
    console.log(`  - ${arquivo}`);
  }
}

construir().catch((erro) => {
  console.error('Falha no build:', erro);
  process.exitCode = 1;
});
