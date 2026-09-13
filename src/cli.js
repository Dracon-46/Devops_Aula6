#!/usr/bin/env node
/**
 * CLI do analisador.
 *
 *   node src/cli.js <arquivos...> [--formato=texto|md|json] [--falhar-em=alta]
 *
 * O `--falhar-em` faz o processo sair com codigo 1 quando existe algum achado
 * naquela severidade ou pior, o que permite usar o analisador como barreira
 * de qualidade dentro da propria pipeline.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { analisar, formatarMarkdown, formatarTexto } from './report.js';
import { SEVERIDADES, reprova } from './rules.js';

const FORMATOS = ['texto', 'md', 'json'];

/**
 * Separa argumentos em arquivos e opcoes.
 *
 * @param {string[]} argumentos normalmente `process.argv.slice(2)`
 * @returns {{arquivos: string[], formato: string, falharEm: string|null}}
 */
export function lerArgumentos(argumentos) {
  const arquivos = [];
  let formato = 'texto';
  let falharEm = null;

  for (const argumento of argumentos) {
    if (argumento.startsWith('--formato=')) {
      const valor = argumento.slice('--formato='.length);
      if (!FORMATOS.includes(valor)) {
        throw new Error(`formato invalido: ${valor} (use ${FORMATOS.join(', ')})`);
      }
      formato = valor;
    } else if (argumento.startsWith('--falhar-em=')) {
      const valor = argumento.slice('--falhar-em='.length);
      if (!SEVERIDADES.includes(valor)) {
        throw new Error(
          `severidade invalida: ${valor} (use ${SEVERIDADES.join(', ')})`,
        );
      }
      falharEm = valor;
    } else if (argumento.startsWith('--')) {
      throw new Error(`opcao desconhecida: ${argumento}`);
    } else {
      arquivos.push(argumento);
    }
  }

  return { arquivos, formato, falharEm };
}

async function principal() {
  let opcoes;
  try {
    opcoes = lerArgumentos(process.argv.slice(2));
  } catch (erro) {
    console.error(`Erro: ${erro.message}`);
    process.exitCode = 2;
    return;
  }

  if (opcoes.arquivos.length === 0) {
    console.error(
      'Uso: node src/cli.js <workflow.yml...> [--formato=texto|md|json] [--falhar-em=alta]',
    );
    process.exitCode = 2;
    return;
  }

  const analises = [];
  for (const caminho of opcoes.arquivos) {
    try {
      const conteudo = await readFile(caminho, 'utf8');
      analises.push(analisar(conteudo, { origem: basename(caminho) }));
    } catch (erro) {
      console.error(`Falha ao analisar ${caminho}: ${erro.message}`);
      process.exitCode = 2;
      return;
    }
  }

  if (opcoes.formato === 'json') {
    console.log(
      JSON.stringify(
        analises.map((a) => ({ resumo: a.resumo, contagem: a.contagem, achados: a.achados })),
        null,
        2,
      ),
    );
  } else {
    const formatar = opcoes.formato === 'md' ? formatarMarkdown : formatarTexto;
    console.log(analises.map(formatar).join('\n\n'));
  }

  const todosAchados = analises.flatMap((a) => a.achados);
  if (reprova(todosAchados, opcoes.falharEm)) {
    console.error(
      `\nReprovado: existe achado de severidade ${opcoes.falharEm} ou pior.`,
    );
    process.exitCode = 1;
  }
}

/**
 * Só executa quando o arquivo é chamado direto pelo node. Sem essa guarda,
 * importar o módulo em um teste dispararia a CLI como efeito colateral.
 */
export function foiChamadoDiretamente(argv = process.argv) {
  return Boolean(argv[1]) && import.meta.url === pathToFileURL(argv[1]).href;
}

if (foiChamadoDiretamente()) {
  principal();
}
