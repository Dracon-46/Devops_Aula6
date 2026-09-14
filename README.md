# Jokenpô — Aula 6 de DevOps

[![Pipeline CI](https://github.com/Dracon-46/Devops_Aula6/actions/workflows/pipeline.yml/badge.svg)](https://github.com/Dracon-46/Devops_Aula6/actions/workflows/pipeline.yml)

**Jogue:** <https://dracon-46.github.io/Devops_Aula6/>

Pedra, papel ou tesoura jogável no navegador, publicado automaticamente no
GitHub Pages a cada push na `main`. Clique numa das três jogadas ou use as
teclas `1`, `2` e `3`.

O jogo é a parte visível; o que a disciplina pede está em volta dele — uma
pipeline que roda a cada push na branch principal, e uma análise de pipelines de
projetos reais.

---

## A pipeline

Gatilho exigido pela Tarefa 06:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```

Quatro jobs encadeados com `needs` — cada um só começa se o anterior passar:

```text
push na main
     │
     ▼
┌──────────────────┐
│ qualidade        │  ESLint
└────────┬─────────┘
         ▼
┌──────────────────┐
│ testes           │  matriz Node 20 e 22 · 127 testes · JUnit como artefato
└────────┬─────────┘
         ▼
┌──────────────────┐
│ auto-analise     │  a pipeline analisa o próprio workflow
└────────┬─────────┘
         ▼
┌──────────────────┐
│ publicar         │  build → dist/ → GitHub Pages
└──────────────────┘
```

O job `auto-analise` é o detalhe menos comum: o repositório contém um analisador
de workflows, e a pipeline roda esse analisador **sobre o próprio `pipeline.yml`
que a está executando**, com `--falhar-em=alta`. Se alguém introduzir no workflow
uma ação sem versão, uma permissão ampla demais ou uma interpolação insegura em
`run:`, o job reprova. O relatório vai para o resumo da execução.

Hoje ele acusa um achado de severidade `media`: a `peaceiris/actions-gh-pages@v4`
usa tag móvel em vez de SHA fixo. Como não é `alta`, não reprova — fica
registrado como dívida consciente, e está explicado no documento de análise.

---

## O jogo

Jokenpô tem uma regra pequena o bastante para caber numa tabela, e é justamente
isso que deixa a lógica 100% pura — nenhuma função de `src/jogo.js` toca no DOM:

```js
export const VENCE_DE = { pedra: 'tesoura', papel: 'pedra', tesoura: 'papel' };

vencedor('pedra', 'tesoura'); // → 'jogador'
vencedor('papel', 'tesoura'); // → 'computador'
vencedor('papel', 'papel');   // → 'empate'
```

O que impede o jogo de virar puro sorteio é o adversário. Nas três primeiras
rodadas o computador joga aleatório; da quarta em diante ele conta o histórico,
descobre qual jogada você mais repete e escolhe exatamente a que ganha dela:

```js
jogadaDoComputador(['pedra', 'pedra', 'pedra']); // → 'papel'
```

Quem fica martelando a mesma tecla começa a perder — e dá para ver isso no
campo **aproveitamento** do placar.

Duas decisões existem só para tornar o jogo testável sem navegador:

- **o sorteio entra por parâmetro** (`jogadaDoComputador(historico, sorteio)`),
  então o teste fixa exatamente o que o computador vai jogar;
- **o desempate de `jogadaMaisUsada` é determinístico** — segue a ordem de
  `JOGADAS` em vez de depender da ordem de chegada.

O placar também é imutável: `registrar` e `jogarRodada` devolvem um estado novo
em vez de alterar o recebido, o que elimina bug de estado compartilhado e deixa
os testes diretos.

### Separação

```text
src/jogo.js   regras puras, sem DOM      →  testado (47 testes)
src/ui.js     mãos, cliques, teclado     →  não testado, de propósito
```

`src/ui.js` não conhece nenhuma regra; `src/jogo.js` não sabe que existe uma
página. É o que permite os testes rodarem dentro do runner, sem navegador.

---

## Análise de pipelines reais

Segunda parte da tarefa: três repositórios reais analisados em
**[`docs/analise-repositorios.md`](docs/analise-repositorios.md)** — axios,
FastAPI e Caddy. Cada um foi clonado com histórico completo, teve os workflows
processados pelo analisador deste repositório, e o histórico saiu de `git log` e
`git rev-list` sobre `.github/workflows`.

| | axios | fastapi | caddy |
| --- | --- | --- | --- |
| Workflows | 8 | 20 | 9 |
| Jobs no CI principal | 7 | 6 | 3 |
| Ações fixadas por SHA | 7/7 | 8/8 | 5/5 |
| Primeiro workflow | 18/06/2020 | 27/11/2019 | 20/03/2020 |
| Commits em workflows | 145 | 343 | 126 |

---

## O analisador

Ferramenta de linha de comando que lê um workflow `.yml`, monta um modelo
(gatilhos, jobs, `needs`, matriz, ações) e aplica dez regras:

| Regra | Severidade |
| --- | --- |
| `pull_request_target` com checkout da ref do PR | crítica |
| `uses:` sem `@versao` | alta |
| ação apontando para `@main` / `@master` | alta |
| `write-all` ou `contents: write` no topo | alta |
| título/corpo de issue interpolado em `run:` | alta |
| ação de terceiro em tag móvel | média |
| sem bloco `permissions` | média |
| job sem `timeout-minutes` | baixa |
| workflow de push/PR sem `concurrency` | baixa |
| não dispara em push na `main` | info |

```bash
node src/cli.js .github/workflows/pipeline.yml
node src/cli.js .github/workflows/*.yml --formato=md
node src/cli.js .github/workflows/pipeline.yml --falhar-em=alta
```

---

## Estrutura

```text
Devops_Aula6/
├── .github/workflows/pipeline.yml
├── docs/analise-repositorios.md   # análise dos 3 repositórios
├── public/                        # a página do jogo
│   ├── index.html
│   └── estilo.css
├── scripts/build.mjs              # monta dist/ para o Pages
├── src/
│   ├── jogo.js                    # regras do jokenpô (puras)
│   ├── ui.js                      # mãos, cliques e teclado
│   ├── parser.js                  # analisador: YAML → modelo
│   ├── rules.js                   # analisador: as dez regras
│   ├── report.js                  # analisador: relatório
│   └── cli.js                     # analisador: linha de comando
└── tests/
    ├── jogo.test.js               # 47 testes
    ├── parser.test.js             # 43 testes
    └── analise.test.js            # 37 testes
```

## Scripts

```bash
npm install
npm test          # 127 testes
npm run build     # gera dist/
npm run lint      # ESLint
```

Para abrir o jogo localmente (módulos ES exigem HTTP, não funcionam por
`file://`):

```bash
npm run build && python3 -m http.server -d dist 4177
```

---

## Autor

Arthur Gaspare Camzano — [@Dracon-46](https://github.com/Dracon-46)
Disciplina de DevOps — Tarefa 06.
