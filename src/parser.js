/**
 * Parser de workflows do GitHub Actions.
 *
 * Converte o YAML bruto de um arquivo de workflow em um modelo normalizado,
 * com gatilhos, jobs, passos e acoes ja separados e classificados. Todo o
 * resto do projeto (regras e relatorio) trabalha em cima desse modelo, nunca
 * do YAML cru.
 */

import { parse } from 'yaml';

/** Acoes mantidas pela propria GitHub, usadas para classificar a origem. */
const DONOS_OFICIAIS = new Set(['actions', 'github']);

/** Eventos que aceitam filtro de branch. */
const EVENTOS_COM_BRANCH = new Set([
  'push',
  'pull_request',
  'pull_request_target',
  'workflow_run',
]);

function ehObjeto(valor) {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function comoLista(valor) {
  if (valor === undefined || valor === null) {
    return [];
  }
  return Array.isArray(valor) ? valor : [valor];
}

/**
 * Le a chave de gatilhos do workflow.
 *
 * O YAML 1.1 interpreta `on:` sem aspas como o booleano `true`, entao o
 * documento pode chegar aqui tanto com a chave `on` quanto com a chave `true`.
 * As duas formas sao aceitas.
 */
export function lerChaveDeGatilhos(documento) {
  if (!ehObjeto(documento)) {
    return undefined;
  }
  if (documento.on !== undefined) {
    return documento.on;
  }
  if (documento.true !== undefined) {
    return documento.true;
  }
  return documento[true];
}

/**
 * Normaliza os gatilhos para uma lista de `{ evento, filtros }`.
 *
 * Aceita as tres formas validas: string (`on: push`), lista
 * (`on: [push, pull_request]`) e mapa (`on: { push: { branches: [main] } }`).
 *
 * @param {unknown} on valor bruto da chave de gatilhos
 * @returns {Array<{evento: string, filtros: object}>}
 */
export function normalizarGatilhos(on) {
  if (typeof on === 'string') {
    return [{ evento: on, filtros: {} }];
  }

  if (Array.isArray(on)) {
    return on
      .filter((evento) => typeof evento === 'string')
      .map((evento) => ({ evento, filtros: {} }));
  }

  if (ehObjeto(on)) {
    return Object.entries(on).map(([evento, filtros]) => ({
      evento,
      filtros: ehObjeto(filtros) ? filtros : {},
    }));
  }

  return [];
}

/**
 * Quebra o valor de um `uses:` em partes e classifica a referencia.
 *
 * @param {string} uses valor bruto, ex. `actions/checkout@v4`
 * @returns {object|null} descricao da acao, ou null se nao for reconhecivel
 */
export function extrairAcao(uses) {
  if (typeof uses !== 'string' || uses.trim() === '') {
    return null;
  }

  const referenciaCompleta = uses.trim();

  if (referenciaCompleta.startsWith('docker://')) {
    return {
      referenciaCompleta,
      tipo: 'docker',
      dono: null,
      repositorio: null,
      caminho: null,
      referencia: null,
      tipoReferencia: 'nenhuma',
      fixada: false,
    };
  }

  if (referenciaCompleta.startsWith('./') || referenciaCompleta.startsWith('../')) {
    return {
      referenciaCompleta,
      tipo: 'local',
      dono: null,
      repositorio: null,
      caminho: referenciaCompleta,
      referencia: null,
      tipoReferencia: 'nenhuma',
      fixada: true,
    };
  }

  const [semRef, referencia = null] = referenciaCompleta.split('@');
  const partes = semRef.split('/');

  if (partes.length < 2) {
    return null;
  }

  const [dono, repositorio, ...restante] = partes;
  const tipoReferencia = classificarReferencia(referencia);

  return {
    referenciaCompleta,
    tipo: DONOS_OFICIAIS.has(dono) ? 'oficial' : 'terceiro',
    dono,
    repositorio,
    caminho: restante.length > 0 ? restante.join('/') : null,
    referencia,
    tipoReferencia,
    fixada: tipoReferencia === 'sha',
  };
}

/**
 * Classifica a referencia de uma acao: commit fixo, tag de versao ou branch.
 *
 * @param {string|null} referencia parte depois do `@`
 * @returns {'sha'|'tag'|'branch'|'nenhuma'}
 */
export function classificarReferencia(referencia) {
  if (!referencia) {
    return 'nenhuma';
  }
  if (/^[0-9a-f]{40}$/i.test(referencia)) {
    return 'sha';
  }
  if (/^v?\d+(\.\d+)*/.test(referencia)) {
    return 'tag';
  }
  return 'branch';
}

function normalizarPasso(passo, indice) {
  if (!ehObjeto(passo)) {
    return {
      indice,
      nome: `passo ${indice + 1}`,
      uses: null,
      acao: null,
      run: null,
      condicao: null,
      entradas: {},
      ambiente: {},
    };
  }

  const uses = typeof passo.uses === 'string' ? passo.uses : null;

  return {
    indice,
    nome: passo.name || uses || `passo ${indice + 1}`,
    uses,
    acao: extrairAcao(uses),
    run: typeof passo.run === 'string' ? passo.run : null,
    condicao: passo.if ?? null,
    entradas: ehObjeto(passo.with) ? passo.with : {},
    ambiente: ehObjeto(passo.env) ? passo.env : {},
  };
}

function normalizarJob(id, job) {
  if (!ehObjeto(job)) {
    return {
      id,
      nome: id,
      executor: null,
      needs: [],
      condicao: null,
      timeoutMinutos: null,
      permissoes: null,
      matriz: null,
      usaWorkflowReutilizavel: null,
      passos: [],
    };
  }

  const estrategia = ehObjeto(job.strategy) ? job.strategy : null;

  return {
    id,
    nome: job.name || id,
    executor: job['runs-on'] ?? null,
    needs: comoLista(job.needs).filter((n) => typeof n === 'string'),
    condicao: job.if ?? null,
    timeoutMinutos: job['timeout-minutes'] ?? null,
    permissoes: job.permissions ?? null,
    matriz: estrategia && ehObjeto(estrategia.matrix) ? estrategia.matrix : null,
    usaWorkflowReutilizavel: typeof job.uses === 'string' ? job.uses : null,
    passos: comoLista(job.steps).map(normalizarPasso),
  };
}

/**
 * Faz o parse de um workflow e devolve o modelo normalizado.
 *
 * @param {string} conteudo conteudo do arquivo .yml
 * @param {{origem?: string}} opcoes origem usada nas mensagens do relatorio
 * @returns {object} modelo do workflow
 */
export function parsearWorkflow(conteudo, opcoes = {}) {
  if (typeof conteudo !== 'string') {
    throw new TypeError('conteudo deve ser uma string com o YAML do workflow');
  }

  const origem = opcoes.origem || 'workflow.yml';

  let documento;
  try {
    documento = parse(conteudo);
  } catch (erro) {
    throw new SyntaxError(`YAML invalido em ${origem}: ${erro.message}`);
  }

  if (!ehObjeto(documento)) {
    throw new SyntaxError(`${origem} nao contem um workflow valido`);
  }

  const gatilhos = normalizarGatilhos(lerChaveDeGatilhos(documento));
  const jobs = ehObjeto(documento.jobs)
    ? Object.entries(documento.jobs).map(([id, job]) => normalizarJob(id, job))
    : [];

  const acoes = [];
  const vistas = new Set();
  for (const job of jobs) {
    for (const passo of job.passos) {
      if (passo.acao && !vistas.has(passo.acao.referenciaCompleta)) {
        vistas.add(passo.acao.referenciaCompleta);
        acoes.push(passo.acao);
      }
    }
  }

  return {
    origem,
    nome: documento.name || origem,
    gatilhos,
    permissoes: documento.permissions ?? null,
    concurrency: documento.concurrency ?? null,
    defaults: documento.defaults ?? null,
    jobs,
    acoes,
  };
}

/**
 * Diz se o workflow dispara em push para alguma das branches informadas.
 *
 * @param {object} modelo modelo devolvido por `parsearWorkflow`
 * @param {string} branch nome da branch, ex. `main`
 * @returns {boolean}
 */
export function disparaEmPushPara(modelo, branch = 'main') {
  const push = modelo.gatilhos.find((g) => g.evento === 'push');
  if (!push) {
    return false;
  }

  const branches = comoLista(push.filtros.branches);
  if (branches.length === 0) {
    // `on: push` sem filtro dispara em qualquer branch, inclusive a informada.
    return true;
  }

  return branches.some((padrao) => corresponde(padrao, branch));
}

/**
 * Compara um padrao de branch do GitHub Actions com um nome concreto.
 * Suporta os curingas `*` (nao cruza `/`) e `**` (cruza qualquer coisa).
 *
 * @param {string} padrao ex. `releases/**`
 * @param {string} nome ex. `releases/v1`
 * @returns {boolean}
 */
export function corresponde(padrao, nome) {
  if (typeof padrao !== 'string' || typeof nome !== 'string') {
    return false;
  }
  if (padrao === nome) {
    return true;
  }

  const expressao = padrao
    .split('**')
    .map((parte) =>
      parte
        .split('*')
        .map((pedaco) => pedaco.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');

  return new RegExp(`^${expressao}$`).test(nome);
}

export { EVENTOS_COM_BRANCH };
