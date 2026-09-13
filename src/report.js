/**
 * Montagem do relatorio: resumo do workflow e formatacao da saida.
 */

import { SEVERIDADES, aplicarRegras, contarPorSeveridade } from './rules.js';
import { parsearWorkflow } from './parser.js';

const ROTULO_SEVERIDADE = {
  critica: 'CRITICA',
  alta: 'ALTA',
  media: 'MEDIA',
  baixa: 'BAIXA',
  info: 'INFO',
};

function descreverFiltros(filtros) {
  const partes = [];
  for (const chave of ['branches', 'branches-ignore', 'tags', 'paths', 'types']) {
    const valor = filtros[chave];
    if (valor !== undefined) {
      const lista = Array.isArray(valor) ? valor : [valor];
      partes.push(`${chave}: ${lista.join(', ')}`);
    }
  }
  if (filtros.cron) {
    partes.push('cron');
  }
  if (Array.isArray(filtros) && filtros.length > 0 && filtros[0].cron) {
    partes.push(`cron: ${filtros.map((f) => f.cron).join(' | ')}`);
  }
  return partes.join('; ');
}

/**
 * Resume as caracteristicas estruturais do workflow.
 *
 * @param {object} modelo modelo devolvido por `parsearWorkflow`
 * @returns {object} resumo pronto para exibicao
 */
export function resumir(modelo) {
  const passos = modelo.jobs.reduce((total, job) => total + job.passos.length, 0);
  const comMatriz = modelo.jobs.filter((job) => job.matriz !== null);
  const encadeados = modelo.jobs.filter((job) => job.needs.length > 0);

  return {
    nome: modelo.nome,
    origem: modelo.origem,
    gatilhos: modelo.gatilhos.map((g) => ({
      evento: g.evento,
      filtros: descreverFiltros(Array.isArray(g.filtros) ? {} : g.filtros),
    })),
    totalJobs: modelo.jobs.length,
    totalPassos: passos,
    jobsComMatriz: comMatriz.map((job) => job.id),
    jobsEncadeados: encadeados.map((job) => `${job.id} <- ${job.needs.join(', ')}`),
    acoesOficiais: modelo.acoes.filter((a) => a.tipo === 'oficial').length,
    acoesDeTerceiros: modelo.acoes.filter((a) => a.tipo === 'terceiro').length,
    acoesFixadasPorSha: modelo.acoes.filter((a) => a.fixada).length,
    totalAcoes: modelo.acoes.length,
    declaraPermissoes: modelo.permissoes !== null,
    declaraConcorrencia: modelo.concurrency !== null,
  };
}

/**
 * Faz o ciclo completo: parse, regras e resumo.
 *
 * @param {string} conteudo YAML do workflow
 * @param {{origem?: string}} opcoes origem para as mensagens
 * @returns {{modelo: object, resumo: object, achados: Array, contagem: object}}
 */
export function analisar(conteudo, opcoes = {}) {
  const modelo = parsearWorkflow(conteudo, opcoes);
  const achados = aplicarRegras(modelo);

  return {
    modelo,
    resumo: resumir(modelo),
    achados,
    contagem: contarPorSeveridade(achados),
  };
}

/**
 * Formata a analise como texto simples (saida de terminal).
 *
 * @param {object} analise resultado de `analisar`
 * @returns {string}
 */
export function formatarTexto(analise) {
  const { resumo, achados, contagem } = analise;
  const linhas = [];

  linhas.push(`Workflow: ${resumo.nome}  (${resumo.origem})`);
  linhas.push(
    `Gatilhos: ${
      resumo.gatilhos
        .map((g) => (g.filtros ? `${g.evento} [${g.filtros}]` : g.evento))
        .join(', ') || 'nenhum'
    }`,
  );
  linhas.push(`Jobs: ${resumo.totalJobs}  |  Passos: ${resumo.totalPassos}`);
  linhas.push(
    `Acoes: ${resumo.totalAcoes} (${resumo.acoesOficiais} oficiais, ` +
      `${resumo.acoesDeTerceiros} de terceiros, ${resumo.acoesFixadasPorSha} com SHA fixo)`,
  );
  if (resumo.jobsEncadeados.length > 0) {
    linhas.push(`Encadeamento: ${resumo.jobsEncadeados.join(' | ')}`);
  }
  if (resumo.jobsComMatriz.length > 0) {
    linhas.push(`Matriz: ${resumo.jobsComMatriz.join(', ')}`);
  }
  linhas.push('');

  const resumoContagem = SEVERIDADES.filter((sev) => contagem[sev] > 0)
    .map((sev) => `${contagem[sev]} ${sev}`)
    .join(', ');
  linhas.push(`Achados: ${achados.length}${resumoContagem ? ` (${resumoContagem})` : ''}`);

  for (const item of achados) {
    linhas.push(`  [${ROTULO_SEVERIDADE[item.severidade]}] ${item.titulo}`);
    linhas.push(`      ${item.mensagem}`);
    linhas.push(`      em: ${item.local}`);
  }

  return linhas.join('\n');
}

/**
 * Formata a analise como Markdown (usado no resumo do job e nos documentos).
 *
 * @param {object} analise resultado de `analisar`
 * @returns {string}
 */
export function formatarMarkdown(analise) {
  const { resumo, achados, contagem } = analise;
  const linhas = [];

  linhas.push(`### ${resumo.nome}`);
  linhas.push('');
  linhas.push(`Arquivo: \`${resumo.origem}\``);
  linhas.push('');
  linhas.push('| Caracteristica | Valor |');
  linhas.push('| --- | --- |');
  linhas.push(
    `| Gatilhos | ${
      resumo.gatilhos
        .map((g) => (g.filtros ? `\`${g.evento}\` (${g.filtros})` : `\`${g.evento}\``))
        .join(', ') || '—'
    } |`,
  );
  linhas.push(`| Jobs | ${resumo.totalJobs} |`);
  linhas.push(`| Passos | ${resumo.totalPassos} |`);
  linhas.push(
    `| Acoes | ${resumo.totalAcoes} (${resumo.acoesOficiais} oficiais / ` +
      `${resumo.acoesDeTerceiros} de terceiros) |`,
  );
  linhas.push(`| Acoes com SHA fixo | ${resumo.acoesFixadasPorSha} |`);
  linhas.push(`| Declara \`permissions\` | ${resumo.declaraPermissoes ? 'sim' : 'nao'} |`);
  linhas.push(`| Declara \`concurrency\` | ${resumo.declaraConcorrencia ? 'sim' : 'nao'} |`);
  linhas.push(
    `| Encadeamento (\`needs\`) | ${
      resumo.jobsEncadeados.length > 0 ? resumo.jobsEncadeados.join('; ') : 'nenhum'
    } |`,
  );
  linhas.push(
    `| Matriz | ${resumo.jobsComMatriz.length > 0 ? resumo.jobsComMatriz.join(', ') : 'nao usa'} |`,
  );
  linhas.push('');

  if (achados.length === 0) {
    linhas.push('Nenhum achado.');
    return linhas.join('\n');
  }

  const resumoContagem = SEVERIDADES.filter((sev) => contagem[sev] > 0)
    .map((sev) => `**${contagem[sev]}** ${sev}`)
    .join(' · ');
  linhas.push(`**${achados.length} achado(s):** ${resumoContagem}`);
  linhas.push('');
  linhas.push('| Severidade | Regra | Onde | Detalhe |');
  linhas.push('| --- | --- | --- | --- |');
  for (const item of achados) {
    linhas.push(
      `| ${ROTULO_SEVERIDADE[item.severidade]} | ${item.titulo} | \`${item.local}\` | ${item.mensagem} |`,
    );
  }

  return linhas.join('\n');
}
