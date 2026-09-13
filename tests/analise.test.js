import { describe, it, expect } from 'vitest';

import { parsearWorkflow } from '../src/parser.js';
import {
  REGRAS,
  SEVERIDADES,
  aplicarRegras,
  contarPorSeveridade,
  reprova,
} from '../src/rules.js';
import { analisar, formatarMarkdown, formatarTexto, resumir } from '../src/report.js';
import { lerArgumentos } from '../src/cli.js';

function achadosDe(yaml, idDaRegra) {
  const modelo = parsearWorkflow(yaml, { origem: 'teste.yml' });
  const achados = aplicarRegras(modelo);
  return idDaRegra ? achados.filter((a) => a.regra === idDaRegra) : achados;
}

const WORKFLOW_EXEMPLAR = `
name: Exemplar
on:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: exemplar
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${'c'.repeat(40)}
      - run: npm test
`;

describe('catalogo de regras', () => {
  it('toda regra tem id, titulo, severidade e descricao', () => {
    for (const regra of REGRAS) {
      expect(regra.id).toBeTruthy();
      expect(regra.titulo).toBeTruthy();
      expect(regra.descricao).toBeTruthy();
      expect(SEVERIDADES).toContain(regra.severidade);
    }
  });

  it('nao tem ids repetidos', () => {
    const ids = REGRAS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('regra acao-sem-referencia', () => {
  it('acusa uses sem @versao', () => {
    const achados = achadosDe(
      'on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout\n',
      'acao-sem-referencia',
    );
    expect(achados).toHaveLength(1);
    expect(achados[0].severidade).toBe('alta');
  });

  it('nao acusa quando ha versao', () => {
    const achados = achadosDe(
      'on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n',
      'acao-sem-referencia',
    );
    expect(achados).toHaveLength(0);
  });
});

describe('regra acao-presa-a-branch', () => {
  it('acusa acao apontando para main', () => {
    const achados = achadosDe(
      'on: push\njobs:\n  a:\n    steps:\n      - uses: alguem/acao@main\n',
      'acao-presa-a-branch',
    );
    expect(achados).toHaveLength(1);
    expect(achados[0].mensagem).toContain('main');
  });
});

describe('regra acao-de-terceiro-sem-sha', () => {
  it('acusa acao de terceiro com tag movel', () => {
    const achados = achadosDe(
      'on: push\njobs:\n  a:\n    steps:\n      - uses: peaceiris/actions-gh-pages@v4\n',
      'acao-de-terceiro-sem-sha',
    );
    expect(achados).toHaveLength(1);
  });

  it('nao acusa acao oficial com tag', () => {
    const achados = achadosDe(
      'on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n',
      'acao-de-terceiro-sem-sha',
    );
    expect(achados).toHaveLength(0);
  });

  it('relata a mesma acao uma unica vez', () => {
    const yaml =
      'on: push\njobs:\n  a:\n    steps:\n      - uses: x/y@v1\n' +
      '  b:\n    steps:\n      - uses: x/y@v1\n';
    expect(achadosDe(yaml, 'acao-de-terceiro-sem-sha')).toHaveLength(1);
  });
});

describe('regra permissoes', () => {
  it('acusa ausencia de permissions', () => {
    const achados = achadosDe(
      'on: push\njobs:\n  a:\n    steps:\n      - run: echo oi\n',
      'permissoes-nao-declaradas',
    );
    expect(achados).toHaveLength(1);
  });

  it('nao acusa quando declara no topo', () => {
    const achados = achadosDe(
      'on: push\npermissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - run: echo\n',
      'permissoes-nao-declaradas',
    );
    expect(achados).toHaveLength(0);
  });

  it('acusa write-all', () => {
    const achados = achadosDe(
      'on: push\npermissions: write-all\njobs:\n  a:\n    steps:\n      - run: echo\n',
      'permissoes-amplas',
    );
    expect(achados).toHaveLength(1);
    expect(achados[0].severidade).toBe('alta');
  });

  it('acusa contents write no topo', () => {
    const achados = achadosDe(
      'on: push\npermissions:\n  contents: write\njobs:\n  a:\n    steps:\n      - run: echo\n',
      'permissoes-amplas',
    );
    expect(achados).toHaveLength(1);
  });
});

describe('regra pull-request-target-perigoso', () => {
  it('acusa checkout da ref do PR', () => {
    const yaml = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  a:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '        with:',
      '          ref: ${{ github.event.pull_request.head.sha }}',
    ].join('\n');
    const achados = achadosDe(yaml, 'pull-request-target-perigoso');
    expect(achados).toHaveLength(1);
    expect(achados[0].severidade).toBe('critica');
  });

  it('nao acusa pull_request_target sem checkout do PR', () => {
    const yaml =
      'on:\n  pull_request_target:\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n';
    expect(achadosDe(yaml, 'pull-request-target-perigoso')).toHaveLength(0);
  });

  it('nao acusa checkout do PR sob pull_request comum', () => {
    const yaml = [
      'on:',
      '  pull_request:',
      'jobs:',
      '  a:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '        with:',
      '          ref: ${{ github.event.pull_request.head.sha }}',
    ].join('\n');
    expect(achadosDe(yaml, 'pull-request-target-perigoso')).toHaveLength(0);
  });
});

describe('regra injecao-em-run', () => {
  it('acusa titulo de issue interpolado no shell', () => {
    const yaml = [
      'on: issues',
      'jobs:',
      '  a:',
      '    steps:',
      '      - run: echo "${{ github.event.issue.title }}"',
    ].join('\n');
    const achados = achadosDe(yaml, 'injecao-em-run');
    expect(achados).toHaveLength(1);
  });

  it('nao acusa quando o texto passa por env', () => {
    const yaml = [
      'on: issues',
      'jobs:',
      '  a:',
      '    steps:',
      '      - run: echo "$TITULO"',
      '        env:',
      '          TITULO: ${{ github.event.issue.title }}',
    ].join('\n');
    expect(achadosDe(yaml, 'injecao-em-run')).toHaveLength(0);
  });
});

describe('regras estruturais', () => {
  it('acusa jobs sem timeout', () => {
    const achados = achadosDe(
      'on: push\njobs:\n  a:\n    steps:\n      - run: echo\n',
      'job-sem-timeout',
    );
    expect(achados).toHaveLength(1);
    expect(achados[0].mensagem).toContain('a');
  });

  it('acusa ausencia de concurrency em workflow de push', () => {
    const achados = achadosDe(
      'on: push\njobs:\n  a:\n    steps:\n      - run: echo\n',
      'sem-controle-de-concorrencia',
    );
    expect(achados).toHaveLength(1);
  });

  it('nao cobra concurrency em workflow agendado', () => {
    const yaml = 'on:\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  a:\n    steps:\n      - run: echo\n';
    expect(achadosDe(yaml, 'sem-controle-de-concorrencia')).toHaveLength(0);
  });

  it('acusa quando nao ha push na main', () => {
    const achados = achadosDe(
      'on:\n  pull_request:\njobs:\n  a:\n    steps:\n      - run: echo\n',
      'sem-push-na-principal',
    );
    expect(achados).toHaveLength(1);
    expect(achados[0].severidade).toBe('info');
  });

  it('nao acusa quando ha push na main', () => {
    const achados = achadosDe(
      'on:\n  push:\n    branches: [main]\njobs:\n  a:\n    steps:\n      - run: echo\n',
      'sem-push-na-principal',
    );
    expect(achados).toHaveLength(0);
  });
});

describe('ordenacao e contagem', () => {
  it('ordena achados da severidade mais grave para a menos grave', () => {
    const yaml = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  a:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '        with:',
      '          ref: ${{ github.event.pull_request.head.sha }}',
    ].join('\n');
    const achados = achadosDe(yaml);
    expect(achados[0].severidade).toBe('critica');
    const severidadeFinal = achados[achados.length - 1].severidade;
    expect(['baixa', 'info']).toContain(severidadeFinal);
  });

  it('conta achados por severidade', () => {
    const contagem = contarPorSeveridade([
      { severidade: 'alta' },
      { severidade: 'alta' },
      { severidade: 'baixa' },
    ]);
    expect(contagem.alta).toBe(2);
    expect(contagem.baixa).toBe(1);
    expect(contagem.critica).toBe(0);
  });

  it('reprova quando existe achado no limite ou pior', () => {
    const achados = [{ severidade: 'alta' }];
    expect(reprova(achados, 'alta')).toBe(true);
    expect(reprova(achados, 'critica')).toBe(false);
    expect(reprova(achados, 'media')).toBe(true);
  });

  it('nao reprova sem limite definido', () => {
    expect(reprova([{ severidade: 'critica' }], null)).toBe(false);
    expect(reprova([{ severidade: 'critica' }], 'inexistente')).toBe(false);
  });
});

describe('resumo e formatacao', () => {
  const analise = analisar(WORKFLOW_EXEMPLAR, { origem: 'exemplar.yml' });

  it('resume as caracteristicas do workflow', () => {
    const resumo = resumir(analise.modelo);
    expect(resumo.totalJobs).toBe(1);
    expect(resumo.totalPassos).toBe(2);
    expect(resumo.acoesFixadasPorSha).toBe(1);
    expect(resumo.declaraPermissoes).toBe(true);
    expect(resumo.declaraConcorrencia).toBe(true);
  });

  it('workflow exemplar nao gera achado de severidade alta ou pior', () => {
    expect(reprova(analise.achados, 'alta')).toBe(false);
  });

  it('formata texto com as secoes principais', () => {
    const texto = formatarTexto(analise);
    expect(texto).toContain('Workflow: Exemplar');
    expect(texto).toContain('Gatilhos:');
    expect(texto).toContain('Achados:');
  });

  it('formata markdown com tabela de caracteristicas', () => {
    const md = formatarMarkdown(analise);
    expect(md).toContain('### Exemplar');
    expect(md).toContain('| Caracteristica | Valor |');
    expect(md).toContain('| Jobs | 1 |');
  });

  it('markdown avisa quando nao ha achado', () => {
    const semAchado = analisar(
      [
        'name: Limpo',
        'on:',
        '  push:',
        '    branches: [main]',
        'permissions:',
        '  contents: read',
        'concurrency:',
        '  group: limpo',
        'jobs:',
        '  a:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 5',
        '    steps:',
        '      - run: echo ok',
      ].join('\n'),
      { origem: 'limpo.yml' },
    );
    expect(semAchado.achados).toHaveLength(0);
    expect(formatarMarkdown(semAchado)).toContain('Nenhum achado.');
  });
});

describe('lerArgumentos', () => {
  it('separa arquivos das opcoes', () => {
    const opcoes = lerArgumentos(['a.yml', 'b.yml', '--formato=md']);
    expect(opcoes.arquivos).toEqual(['a.yml', 'b.yml']);
    expect(opcoes.formato).toBe('md');
  });

  it('usa texto como formato padrao', () => {
    expect(lerArgumentos(['a.yml']).formato).toBe('texto');
    expect(lerArgumentos(['a.yml']).falharEm).toBeNull();
  });

  it('le o limite de reprovacao', () => {
    expect(lerArgumentos(['a.yml', '--falhar-em=critica']).falharEm).toBe('critica');
  });

  it('rejeita formato invalido', () => {
    expect(() => lerArgumentos(['--formato=pdf'])).toThrow(/formato invalido/);
  });

  it('rejeita severidade invalida', () => {
    expect(() => lerArgumentos(['--falhar-em=urgente'])).toThrow(/severidade invalida/);
  });

  it('rejeita opcao desconhecida', () => {
    expect(() => lerArgumentos(['--turbo'])).toThrow(/opcao desconhecida/);
  });
});
