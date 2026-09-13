# Analisador de Pipelines — Aula 6 de DevOps

[![Pipeline CI](https://github.com/Dracon-46/Devops_Aula6/actions/workflows/pipeline.yml/badge.svg)](https://github.com/Dracon-46/Devops_Aula6/actions/workflows/pipeline.yml)

Projeto da **Tarefa 06**. A tarefa tinha duas partes: integrar uma pipeline que
rode a cada push na branch principal, e analisar pelo menos tres repositorios do
GitHub que tenham pipeline, olhando caracteristicas, funcionalidades, gatilhos e
historico.

Em vez de tratar as duas partes como coisas separadas, o projeto e a ferramenta
que faz a segunda parte: um **analisador estatico de workflows do GitHub
Actions**. Ele le um arquivo `.yml`, monta um modelo do workflow (gatilhos, jobs,
encadeamento, matriz, acoes) e aplica dez regras de qualidade e seguranca.

A analise dos tres repositorios esta em
**[`docs/analise-repositorios.md`](docs/analise-repositorios.md)** e foi gerada
rodando esta ferramenta em cima do codigo real do axios, do FastAPI e do Caddy.

## A pipeline

O gatilho obrigatorio da tarefa e o push na `main`:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```

Sao tres jobs encadeados com `needs`:

```text
push na main
     │
     ▼
┌──────────────────┐
│ qualidade        │  ESLint sobre src/ e tests/
└────────┬─────────┘
         │ needs
         ▼
┌──────────────────┐
│ testes           │  matriz Node 20 e 22 · 80 testes · relatorio JUnit
└────────┬─────────┘  como artefato
         │ needs
         ▼
┌──────────────────┐
│ auto-analise     │  a ferramenta analisa o PROPRIO workflow
└──────────────────┘  e publica o resultado no resumo do job
```

O terceiro job e o mais interessante: a pipeline roda o analisador sobre o
`pipeline.yml` que a esta executando, com `--falhar-em=alta`. Se alguem
introduzir no workflow uma acao sem versao, uma permissao ampla demais ou uma
interpolacao insegura em `run:`, o proprio job reprova. A ferramenta e a barreira
de qualidade dela mesma.

Alem disso, o relatorio em Markdown vai para `$GITHUB_STEP_SUMMARY`, entao o
resumo da execucao no GitHub mostra a tabela de caracteristicas e os achados sem
precisar abrir log.

## O que o analisador faz

### Modelo extraido

Para cada workflow, o parser normaliza:

- **gatilhos** nas tres formas validas (`on: push`, `on: [a, b]`, `on: { push: {...} }`)
- **jobs**: id, executor, `needs`, `if`, `timeout-minutes`, `permissions`, matriz
- **passos**: `uses`, `run`, `with`, `env`
- **acoes**: dono, repositorio, subcaminho e versao, classificando a referencia
  em `sha`, `tag`, `branch` ou `nenhuma`, e a origem em oficial, terceiro, local
  ou docker

Um detalhe que o parser trata de proposito: em YAML 1.1 a chave `on:` sem aspas
e interpretada como o booleano `true`. O parser aceita as duas formas, e ha teste
cobrindo isso.

### Regras

| Regra | Severidade | O que pega |
| --- | --- | --- |
| `pull-request-target-perigoso` | critica | `pull_request_target` + checkout da ref do PR |
| `acao-sem-referencia` | alta | `uses:` sem `@versao` |
| `acao-presa-a-branch` | alta | acao apontando para `@main` / `@master` |
| `permissoes-amplas` | alta | `write-all` ou `contents: write` no topo |
| `injecao-em-run` | alta | titulo/corpo de issue ou PR interpolado no shell |
| `acao-de-terceiro-sem-sha` | media | acao de terceiro em tag movel |
| `permissoes-nao-declaradas` | media | sem bloco `permissions` |
| `job-sem-timeout` | baixa | job sem `timeout-minutes` |
| `sem-controle-de-concorrencia` | baixa | workflow de push/PR sem `concurrency` |
| `sem-push-na-principal` | info | nao dispara em push na `main` |

As duas regras de severidade alta e critica ligadas a seguranca
(`pull-request-target-perigoso` e `injecao-em-run`) cobrem as duas falhas mais
conhecidas de GitHub Actions: executar codigo de fork com token privilegiado, e
injecao de comando por texto que o atacante controla.

## Uso

```bash
npm install

# analise em texto
node src/cli.js .github/workflows/pipeline.yml

# varios arquivos, saida em Markdown
node src/cli.js .github/workflows/*.yml --formato=md

# saida estruturada, para processar depois
node src/cli.js .github/workflows/pipeline.yml --formato=json

# como barreira: sai com codigo 1 se houver achado alto ou pior
node src/cli.js .github/workflows/pipeline.yml --falhar-em=alta
```

Exemplo de saida:

```text
Workflow: Pipeline CI  (pipeline.yml)
Gatilhos: push [branches: main], pull_request [branches: main], workflow_dispatch
Jobs: 3  |  Passos: 14
Acoes: 3 (3 oficiais, 0 de terceiros, 0 com SHA fixo)
Encadeamento: testes <- qualidade | auto-analise <- testes
Matriz: testes

Achados: 0
```

## Estrutura

```text
Devops_Aula6/
├── .github/workflows/pipeline.yml   # a pipeline (push na main)
├── docs/
│   └── analise-repositorios.md      # Parte 2 da tarefa
├── src/
│   ├── parser.js                    # YAML -> modelo normalizado
│   ├── rules.js                     # as dez regras
│   ├── report.js                    # resumo e formatacao (texto/md)
│   └── cli.js                       # interface de linha de comando
├── tests/
│   ├── parser.test.js               # 43 testes
│   └── analise.test.js              # 37 testes
├── eslint.config.mjs
└── package.json
```

## Scripts

```bash
npm test          # 80 testes (Vitest)
npm run test:ci   # testes + relatorio JUnit em test-results/
npm run lint      # ESLint
npm run analisar  # atalho para a CLI
```

## Limitacao conhecida

A regra `sem-push-na-principal` assume que a branch principal se chama `main`.
Rodando a ferramenta nos tres repositorios reais, todos usam `master` ou branches
versionadas, e por isso recebem o achado `INFO` indevidamente. O achado esta
correto para o requisito da disciplina, mas a regra deveria aceitar a branch
principal como parametro. Fica registrado como proxima melhoria.

## Autor

Arthur Gaspare Camzano — [@Dracon-46](https://github.com/Dracon-46)
Disciplina de DevOps — Tarefa 06.
