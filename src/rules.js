/**
 * Regras de analise aplicadas sobre o modelo de um workflow.
 *
 * Cada regra e um objeto com metadados e uma funcao `avaliar(modelo)` que
 * devolve uma lista de achados. Regras nao lancam excecao: um workflow
 * estranho gera achado, nao erro.
 */

import { disparaEmPushPara } from './parser.js';

/** Severidades, da mais grave para a menos grave. */
export const SEVERIDADES = ['critica', 'alta', 'media', 'baixa', 'info'];

/** Peso usado para ordenar achados. Menor = mais grave. */
export const PESO_SEVERIDADE = Object.fromEntries(
  SEVERIDADES.map((sev, indice) => [sev, indice]),
);

function achado(regra, mensagem, local) {
  return {
    regra: regra.id,
    titulo: regra.titulo,
    severidade: regra.severidade,
    mensagem,
    local,
  };
}

/** Percorre todos os passos de todos os jobs. */
function* cadaPasso(modelo) {
  for (const job of modelo.jobs) {
    for (const passo of job.passos) {
      yield { job, passo };
    }
  }
}

/** Expressoes que trazem texto controlado por quem abre a issue ou o PR. */
const EXPRESSOES_PERIGOSAS = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.comment.body',
  'github.event.review.body',
  'github.event.head_commit.message',
  'github.head_ref',
];

export const REGRAS = [
  {
    id: 'acao-sem-referencia',
    titulo: 'Acao usada sem referencia de versao',
    severidade: 'alta',
    descricao:
      'Um `uses:` sem `@versao` resolve para o branch padrao da acao, que pode ' +
      'mudar a qualquer momento e quebrar (ou comprometer) a pipeline.',
    avaliar(modelo) {
      const achados = [];
      for (const { job, passo } of cadaPasso(modelo)) {
        if (passo.acao && passo.acao.tipo !== 'local' && passo.acao.tipoReferencia === 'nenhuma') {
          achados.push(
            achado(
              this,
              `A acao \`${passo.acao.referenciaCompleta}\` nao declara versao.`,
              `${job.id} > ${passo.nome}`,
            ),
          );
        }
      }
      return achados;
    },
  },

  {
    id: 'acao-presa-a-branch',
    titulo: 'Acao presa a um branch movel',
    severidade: 'alta',
    descricao:
      'Referenciar uma acao por branch (`@main`, `@master`) faz a pipeline ' +
      'executar codigo que pode mudar sem aviso.',
    avaliar(modelo) {
      const achados = [];
      for (const { job, passo } of cadaPasso(modelo)) {
        if (passo.acao && passo.acao.tipoReferencia === 'branch') {
          achados.push(
            achado(
              this,
              `A acao \`${passo.acao.referenciaCompleta}\` aponta para o branch ` +
                `\`${passo.acao.referencia}\`, que nao e imutavel.`,
              `${job.id} > ${passo.nome}`,
            ),
          );
        }
      }
      return achados;
    },
  },

  {
    id: 'acao-de-terceiro-sem-sha',
    titulo: 'Acao de terceiro sem commit fixo',
    severidade: 'media',
    descricao:
      'Tags como `@v4` sao moveis: o autor pode reapontar a tag. Para acoes ' +
      'de terceiros, fixar o SHA do commit e a pratica recomendada.',
    avaliar(modelo) {
      const achados = [];
      const relatadas = new Set();
      for (const { job, passo } of cadaPasso(modelo)) {
        const acao = passo.acao;
        if (
          acao &&
          acao.tipo === 'terceiro' &&
          acao.tipoReferencia === 'tag' &&
          !relatadas.has(acao.referenciaCompleta)
        ) {
          relatadas.add(acao.referenciaCompleta);
          achados.push(
            achado(
              this,
              `A acao de terceiro \`${acao.referenciaCompleta}\` usa tag movel ` +
                'em vez de SHA fixo.',
              `${job.id} > ${passo.nome}`,
            ),
          );
        }
      }
      return achados;
    },
  },

  {
    id: 'permissoes-nao-declaradas',
    titulo: 'Permissoes do GITHUB_TOKEN nao declaradas',
    severidade: 'media',
    descricao:
      'Sem um bloco `permissions`, o token herda o padrao do repositorio, que ' +
      'costuma ser mais amplo do que o workflow precisa.',
    avaliar(modelo) {
      if (modelo.permissoes !== null) {
        return [];
      }
      const jobsSemPermissao = modelo.jobs.filter((job) => job.permissoes === null);
      if (jobsSemPermissao.length === 0) {
        return [];
      }
      return [
        achado(
          this,
          'O workflow nao declara `permissions` no topo nem em ' +
            `${jobsSemPermissao.length} de ${modelo.jobs.length} job(s).`,
          modelo.origem,
        ),
      ];
    },
  },

  {
    id: 'permissoes-amplas',
    titulo: 'Permissoes de escrita amplas',
    severidade: 'alta',
    descricao:
      '`write-all` (ou `contents: write` no topo) da ao token poder de escrita ' +
      'em todo o repositorio, inclusive nos jobs que so precisam ler.',
    avaliar(modelo) {
      const achados = [];
      const checar = (permissoes, local) => {
        if (permissoes === 'write-all') {
          achados.push(achado(this, 'Usa `permissions: write-all`.', local));
          return;
        }
        if (typeof permissoes === 'object' && permissoes !== null) {
          for (const [escopo, valor] of Object.entries(permissoes)) {
            if (valor === 'write' && escopo === 'contents' && local === modelo.origem) {
              achados.push(
                achado(
                  this,
                  'Declara `contents: write` no topo, valendo para todos os jobs.',
                  local,
                ),
              );
            }
          }
        }
      };

      checar(modelo.permissoes, modelo.origem);
      return achados;
    },
  },

  {
    id: 'pull-request-target-perigoso',
    titulo: 'pull_request_target com checkout do codigo do PR',
    severidade: 'critica',
    descricao:
      'O evento `pull_request_target` roda com o token do repositorio base. ' +
      'Combinado com checkout da ref do PR, executa codigo de terceiros com ' +
      'permissao de escrita — e a falha classica de seguranca em Actions.',
    avaliar(modelo) {
      const usaGatilho = modelo.gatilhos.some((g) => g.evento === 'pull_request_target');
      if (!usaGatilho) {
        return [];
      }

      const achados = [];
      for (const { job, passo } of cadaPasso(modelo)) {
        const ehCheckout =
          passo.acao && passo.acao.dono === 'actions' && passo.acao.repositorio === 'checkout';
        const ref = String(passo.entradas.ref ?? '');
        if (ehCheckout && /github\.event\.pull_request|github\.head_ref/.test(ref)) {
          achados.push(
            achado(
              this,
              'Faz checkout da ref do pull request dentro de um workflow ' +
                '`pull_request_target`.',
              `${job.id} > ${passo.nome}`,
            ),
          );
        }
      }
      return achados;
    },
  },

  {
    id: 'injecao-em-run',
    titulo: 'Texto controlado pelo usuario interpolado em run',
    severidade: 'alta',
    descricao:
      'Interpolar titulo, corpo ou nome de branch direto no shell permite ' +
      'injecao de comando. O caminho seguro e passar por `env:` e usar a ' +
      'variavel entre aspas.',
    avaliar(modelo) {
      const achados = [];
      for (const { job, passo } of cadaPasso(modelo)) {
        if (!passo.run) {
          continue;
        }
        for (const expressao of EXPRESSOES_PERIGOSAS) {
          if (passo.run.includes(expressao)) {
            achados.push(
              achado(
                this,
                `O script usa \`\${{ ${expressao} }}\` diretamente no shell.`,
                `${job.id} > ${passo.nome}`,
              ),
            );
            break;
          }
        }
      }
      return achados;
    },
  },

  {
    id: 'job-sem-timeout',
    titulo: 'Job sem timeout',
    severidade: 'baixa',
    descricao:
      'Sem `timeout-minutes`, um job travado ocupa o runner ate o limite ' +
      'padrao de 6 horas.',
    avaliar(modelo) {
      const semTimeout = modelo.jobs.filter(
        (job) => job.timeoutMinutos === null && job.usaWorkflowReutilizavel === null,
      );
      if (semTimeout.length === 0) {
        return [];
      }
      return [
        achado(
          this,
          `${semTimeout.length} de ${modelo.jobs.length} job(s) sem ` +
            `\`timeout-minutes\`: ${semTimeout.map((j) => j.id).join(', ')}.`,
          modelo.origem,
        ),
      ];
    },
  },

  {
    id: 'sem-controle-de-concorrencia',
    titulo: 'Sem controle de concorrencia',
    severidade: 'baixa',
    descricao:
      'Sem `concurrency`, pushes seguidos disparam execucoes paralelas do ' +
      'mesmo workflow, gastando runner a toa.',
    avaliar(modelo) {
      if (modelo.concurrency !== null) {
        return [];
      }
      const temGatilhoFrequente = modelo.gatilhos.some((g) =>
        ['push', 'pull_request', 'pull_request_target'].includes(g.evento),
      );
      if (!temGatilhoFrequente) {
        return [];
      }
      return [
        achado(
          this,
          'O workflow dispara em push/pull_request e nao define `concurrency`.',
          modelo.origem,
        ),
      ];
    },
  },

  {
    id: 'sem-push-na-principal',
    titulo: 'Nao dispara em push na branch principal',
    severidade: 'info',
    descricao:
      'Verificacao especifica do requisito da disciplina: a pipeline deve ' +
      'rodar a cada push na branch principal.',
    avaliar(modelo) {
      if (disparaEmPushPara(modelo, 'main')) {
        return [];
      }
      return [
        achado(
          this,
          'Nenhum gatilho de `push` cobre a branch `main`.',
          modelo.origem,
        ),
      ];
    },
  },
];

/**
 * Aplica todas as regras (ou um subconjunto) sobre o modelo.
 *
 * @param {object} modelo modelo devolvido por `parsearWorkflow`
 * @param {{regras?: Array}} opcoes permite injetar outro conjunto de regras
 * @returns {Array<object>} achados ordenados por severidade
 */
export function aplicarRegras(modelo, opcoes = {}) {
  const regras = opcoes.regras || REGRAS;

  const achados = regras.flatMap((regra) => {
    const resultado = regra.avaliar(modelo);
    return Array.isArray(resultado) ? resultado : [];
  });

  return achados.sort(
    (a, b) => PESO_SEVERIDADE[a.severidade] - PESO_SEVERIDADE[b.severidade],
  );
}

/**
 * Conta os achados por severidade.
 *
 * @param {Array<object>} achados lista devolvida por `aplicarRegras`
 * @returns {Record<string, number>}
 */
export function contarPorSeveridade(achados) {
  const contagem = Object.fromEntries(SEVERIDADES.map((sev) => [sev, 0]));
  for (const item of achados) {
    contagem[item.severidade] += 1;
  }
  return contagem;
}

/**
 * Diz se a analise deve reprovar, dado um limite de severidade.
 *
 * @param {Array<object>} achados achados da analise
 * @param {string} limite severidade minima que reprova, ex. `alta`
 * @returns {boolean}
 */
export function reprova(achados, limite) {
  if (!limite || !SEVERIDADES.includes(limite)) {
    return false;
  }
  return achados.some(
    (item) => PESO_SEVERIDADE[item.severidade] <= PESO_SEVERIDADE[limite],
  );
}
