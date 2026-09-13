import { describe, it, expect } from 'vitest';

import {
  classificarReferencia,
  corresponde,
  disparaEmPushPara,
  extrairAcao,
  lerChaveDeGatilhos,
  normalizarGatilhos,
  parsearWorkflow,
} from '../src/parser.js';

const WORKFLOW_COMPLETO = `
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: "0 3 * * 1"
permissions:
  contents: read
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - name: Rodar lint
        run: npm run lint
  teste:
    runs-on: \${{ matrix.so }}
    needs: lint
    strategy:
      matrix:
        so: [ubuntu-latest, windows-latest]
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
      - run: npm test
`;

describe('normalizarGatilhos', () => {
  it('aceita gatilho em forma de string', () => {
    expect(normalizarGatilhos('push')).toEqual([{ evento: 'push', filtros: {} }]);
  });

  it('aceita gatilho em forma de lista', () => {
    expect(normalizarGatilhos(['push', 'fork'])).toEqual([
      { evento: 'push', filtros: {} },
      { evento: 'fork', filtros: {} },
    ]);
  });

  it('aceita gatilho em forma de mapa com filtros', () => {
    const gatilhos = normalizarGatilhos({ push: { branches: ['main'] } });
    expect(gatilhos).toEqual([{ evento: 'push', filtros: { branches: ['main'] } }]);
  });

  it('trata evento sem filtro dentro do mapa', () => {
    expect(normalizarGatilhos({ workflow_dispatch: null })).toEqual([
      { evento: 'workflow_dispatch', filtros: {} },
    ]);
  });

  it('devolve lista vazia para entrada invalida', () => {
    expect(normalizarGatilhos(undefined)).toEqual([]);
    expect(normalizarGatilhos(42)).toEqual([]);
  });
});

describe('lerChaveDeGatilhos', () => {
  it('le a chave `on` normal', () => {
    expect(lerChaveDeGatilhos({ on: 'push' })).toBe('push');
  });

  it('le a chave convertida para booleano pelo YAML 1.1', () => {
    // `on:` sem aspas vira a chave `true` em parsers YAML 1.1.
    expect(lerChaveDeGatilhos({ true: 'push' })).toBe('push');
  });

  it('devolve undefined quando nao ha gatilho', () => {
    expect(lerChaveDeGatilhos({ name: 'CI' })).toBeUndefined();
  });
});

describe('classificarReferencia', () => {
  it('reconhece SHA de 40 caracteres', () => {
    expect(classificarReferencia('a'.repeat(40))).toBe('sha');
  });

  it('reconhece tag de versao', () => {
    expect(classificarReferencia('v4')).toBe('tag');
    expect(classificarReferencia('v4.1.1')).toBe('tag');
    expect(classificarReferencia('2')).toBe('tag');
  });

  it('trata o resto como branch', () => {
    expect(classificarReferencia('main')).toBe('branch');
    expect(classificarReferencia('master')).toBe('branch');
  });

  it('reconhece ausencia de referencia', () => {
    expect(classificarReferencia(null)).toBe('nenhuma');
    expect(classificarReferencia('')).toBe('nenhuma');
  });
});

describe('extrairAcao', () => {
  it('separa dono, repositorio e versao', () => {
    const acao = extrairAcao('actions/checkout@v4');
    expect(acao).toMatchObject({
      dono: 'actions',
      repositorio: 'checkout',
      referencia: 'v4',
      tipo: 'oficial',
      tipoReferencia: 'tag',
      fixada: false,
    });
  });

  it('marca acao de terceiro', () => {
    expect(extrairAcao('peaceiris/actions-gh-pages@v4').tipo).toBe('terceiro');
  });

  it('marca acao fixada por SHA', () => {
    const acao = extrairAcao(`dorny/test-reporter@${'b'.repeat(40)}`);
    expect(acao.fixada).toBe(true);
    expect(acao.tipoReferencia).toBe('sha');
  });

  it('entende subdiretorio dentro do repositorio', () => {
    const acao = extrairAcao('super-linter/super-linter/slim@v8');
    expect(acao.caminho).toBe('slim');
    expect(acao.repositorio).toBe('super-linter');
  });

  it('reconhece acao local', () => {
    const acao = extrairAcao('./.github/actions/build');
    expect(acao.tipo).toBe('local');
    expect(acao.fixada).toBe(true);
  });

  it('reconhece acao em container docker', () => {
    expect(extrairAcao('docker://alpine:3.19').tipo).toBe('docker');
  });

  it('devolve null para entrada invalida', () => {
    expect(extrairAcao('')).toBeNull();
    expect(extrairAcao(null)).toBeNull();
    expect(extrairAcao('semBarra@v1')).toBeNull();
  });
});

describe('parsearWorkflow', () => {
  const modelo = parsearWorkflow(WORKFLOW_COMPLETO, { origem: 'ci.yml' });

  it('le o nome e a origem', () => {
    expect(modelo.nome).toBe('CI');
    expect(modelo.origem).toBe('ci.yml');
  });

  it('extrai os tres gatilhos', () => {
    expect(modelo.gatilhos.map((g) => g.evento)).toEqual([
      'push',
      'pull_request',
      'schedule',
    ]);
  });

  it('mantem os filtros de branch', () => {
    const push = modelo.gatilhos.find((g) => g.evento === 'push');
    expect(push.filtros.branches).toEqual(['main']);
  });

  it('extrai os jobs com id e nome', () => {
    expect(modelo.jobs.map((j) => j.id)).toEqual(['lint', 'teste']);
  });

  it('le o encadeamento por needs', () => {
    const teste = modelo.jobs.find((j) => j.id === 'teste');
    expect(teste.needs).toEqual(['lint']);
  });

  it('le a matriz de execucao', () => {
    const teste = modelo.jobs.find((j) => j.id === 'teste');
    expect(teste.matriz.so).toEqual(['ubuntu-latest', 'windows-latest']);
    expect(teste.matriz.node).toEqual([20, 22]);
  });

  it('le timeout quando declarado', () => {
    expect(modelo.jobs.find((j) => j.id === 'lint').timeoutMinutos).toBe(10);
    expect(modelo.jobs.find((j) => j.id === 'teste').timeoutMinutos).toBeNull();
  });

  it('deduplica as acoes usadas', () => {
    // actions/checkout@v4 aparece nos dois jobs, mas conta uma vez so.
    expect(modelo.acoes.map((a) => a.referenciaCompleta)).toEqual([
      'actions/checkout@v4',
      'actions/setup-node@v4',
    ]);
  });

  it('le permissoes e concorrencia do topo', () => {
    expect(modelo.permissoes).toEqual({ contents: 'read' });
    expect(modelo.concurrency).not.toBeNull();
  });

  it('conta os passos de cada job', () => {
    expect(modelo.jobs.find((j) => j.id === 'lint').passos).toHaveLength(2);
    expect(modelo.jobs.find((j) => j.id === 'teste').passos).toHaveLength(3);
  });

  it('usa o proprio uses como nome quando o passo nao tem name', () => {
    const primeiro = modelo.jobs[0].passos[0];
    expect(primeiro.nome).toBe('actions/checkout@v4');
  });

  it('rejeita YAML invalido', () => {
    expect(() => parsearWorkflow('a:\n  - b\n - c', { origem: 'x.yml' })).toThrow(
      SyntaxError,
    );
  });

  it('rejeita conteudo que nao e objeto', () => {
    expect(() => parsearWorkflow('- apenas\n- uma\n- lista')).toThrow(SyntaxError);
  });

  it('rejeita entrada que nao e string', () => {
    expect(() => parsearWorkflow({ nao: 'string' })).toThrow(TypeError);
  });

  it('aceita workflow sem jobs', () => {
    const vazio = parsearWorkflow('name: Vazio\non: push\n');
    expect(vazio.jobs).toEqual([]);
    expect(vazio.acoes).toEqual([]);
  });
});

describe('corresponde', () => {
  it('casa nome exato', () => {
    expect(corresponde('main', 'main')).toBe(true);
    expect(corresponde('main', 'develop')).toBe(false);
  });

  it('casa curinga simples sem cruzar barra', () => {
    expect(corresponde('releases/*', 'releases/v1')).toBe(true);
    expect(corresponde('releases/*', 'releases/v1/hotfix')).toBe(false);
  });

  it('casa curinga duplo cruzando barra', () => {
    expect(corresponde('releases/**', 'releases/v1/hotfix')).toBe(true);
  });

  it('escapa caracteres especiais do nome', () => {
    expect(corresponde('v1.0', 'v1x0')).toBe(false);
  });
});

describe('disparaEmPushPara', () => {
  it('reconhece push filtrado na main', () => {
    const modelo = parsearWorkflow('on:\n  push:\n    branches: [main]\n');
    expect(disparaEmPushPara(modelo, 'main')).toBe(true);
  });

  it('reconhece push sem filtro como valido para qualquer branch', () => {
    const modelo = parsearWorkflow('on: push\n');
    expect(disparaEmPushPara(modelo, 'main')).toBe(true);
  });

  it('nega quando o push cobre outra branch', () => {
    const modelo = parsearWorkflow('on:\n  push:\n    branches: [develop]\n');
    expect(disparaEmPushPara(modelo, 'main')).toBe(false);
  });

  it('nega quando nao ha gatilho de push', () => {
    const modelo = parsearWorkflow('on:\n  pull_request:\n    branches: [main]\n');
    expect(disparaEmPushPara(modelo, 'main')).toBe(false);
  });

  it('aceita padrao com curinga', () => {
    const modelo = parsearWorkflow('on:\n  push:\n    branches: ["ma**"]\n');
    expect(disparaEmPushPara(modelo, 'main')).toBe(true);
  });
});
