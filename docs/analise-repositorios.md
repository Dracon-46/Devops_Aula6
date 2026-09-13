# Analise de pipelines em repositorios reais

Segunda parte da Tarefa 06: analisar pelo menos tres repositorios do GitHub que
tenham pipeline integrada, destacando caracteristicas, funcionalidades, gatilhos
e historico.

## Metodologia

A analise nao foi feita de olho. Para cada repositorio:

1. O repositorio foi clonado com historico completo (`git clone --filter=blob:none`).
2. Os arquivos de `.github/workflows/` foram processados pelo **analisador
   construido neste projeto** (`node src/cli.js <arquivos> --formato=json`), que
   extrai gatilhos, jobs, encadeamento, matriz e acoes usadas, e aplica as regras
   de qualidade e seguranca descritas no README.
3. O historico veio do proprio git: `git log --reverse -- .github/workflows` para
   achar o primeiro commit e `git rev-list --count HEAD -- .github/workflows` para
   medir quanto a pipeline foi mexida ao longo do tempo.

Os numeros abaixo sao a saida real dessas execucoes.

---

## 1. axios/axios — biblioteca HTTP em JavaScript

### Caracteristicas

Oito workflows, cada um com uma responsabilidade estreita. O CI principal
(`run-ci.yml`) tem **7 jobs e 46 passos**, e usa **7 acoes, todas fixadas por SHA
de commit** — nenhuma tag movel. O job `build-and-run-vitest` roda primeiro e os
outros seis dependem dele via `needs`, formando um leque: depois do build, seis
jobs de smoke test rodam em paralelo.

### Funcionalidades

O ponto forte do axios e testar o pacote publicado em varios ambientes de
consumo, nao so rodar o teste unitario. Os jobs encadeados cobrem CommonJS, ESM,
Bun e Deno separadamente — ou seja, a pipeline valida que o pacote realmente
importa em cada runtime. Fora do CI, existem workflows dedicados a:

| Workflow | Funcao |
| --- | --- |
| `bundle-size.yml` | Mede o tamanho do bundle a cada PR (evita regressao de peso) |
| `lockfile-lint.yml` | Valida o `package-lock.json` (protege contra dependencia vinda de origem estranha) |
| `verify-build-reproducibility.yml` | Confere que o build e reproduzivel |
| `publish.yml` | Publica no npm |
| `zizmor.yml` | Roda o **zizmor**, um analisador estatico de seguranca para os proprios workflows |
| `moderator.yml` | Automacao de moderacao de issues e comentarios |

### Gatilhos

| Workflow | Gatilho |
| --- | --- |
| `run-ci.yml` | `pull_request` (types: opened, synchronize, reopened) |
| `bundle-size.yml` | `pull_request` |
| `lockfile-lint.yml` | `pull_request` filtrado por `paths` + `push` |
| `publish.yml` | `push` em **tags** `v1.*.*` |
| `release-branch.yml` | `workflow_dispatch` (manual, 8 jobs) |
| `zizmor.yml` | `push` na branch `v1.x` e `pull_request` |
| `moderator.yml` | `issues`, `issue_comment`, `pull_request_review_comment` |

Vale notar o padrao: o CI **nao** dispara em push na branch principal — ele roda
em pull request. O push so aciona pipeline quando e uma tag de versao, que
dispara a publicacao. E um desenho de "tudo entra por PR".

### Historico

- Primeiro workflow: **18/06/2020** (`Add GitHub actions to close invalid issues`).
  Curiosamente, a primeira automacao nao foi teste — foi moderacao de issues.
- **145 commits** tocaram `.github/workflows` desde entao.
- Atividade recente (2026): atualizacoes automaticas de versao das acoes pelo
  Dependabot, agrupadas em `github-actions group`, e ajustes no smoke test de ESM.

### Saida do analisador

```text
Workflow: Continuous integration  (run-ci.yml)
Gatilhos: pull_request [types: opened, synchronize, reopened]
Jobs: 7  |  Passos: 46
Acoes: 7 (5 oficiais, 2 de terceiros, 7 com SHA fixo)
Achados: 2 (1 baixa, 1 info)
  [BAIXA] Job sem timeout — 7 de 7 job(s) sem `timeout-minutes`
  [INFO]  Nao dispara em push na branch principal
```

---

## 2. fastapi/fastapi — framework web em Python

### Caracteristicas

O maior dos tres em automacao: **20 workflows**. O `test.yml` tem **6 jobs e 41
passos**, com **8 acoes, todas fixadas por SHA**. O encadeamento e mais elaborado
que o do axios:

```text
changes ──> test ──────> coverage-combine ─┐
        └─> benchmark ───────────────────-─┼─> test-alls-green
            regression-test ──────────────-┘
```

O job `changes` roda primeiro e detecta o que mudou; os demais so rodam se
valer a pena. E o `test-alls-green` no final e um job agregador — existe para
ser o unico check obrigatorio na protecao de branch, resolvendo o problema de
ter que marcar dezenas de jobs de matriz como obrigatorios um a um.

A matriz do `test` e multidimensional: sistema operacional × versao do Python ×
estrategia de resolucao de dependencia × origem do Starlette (PyPI ou git), com
entradas extras via `include`. Ou seja, testa inclusive contra a versao de
desenvolvimento de uma dependencia critica.

### Funcionalidades

Aqui a pipeline vai muito alem de testar. Boa parte dos workflows automatiza a
**gestao do projeto**, nao o codigo:

| Workflow | Funcao |
| --- | --- |
| `test.yml` | Testes em matriz + cobertura |
| `build-docs.yml` / `deploy-docs.yml` | Constroi e publica a documentacao |
| `notify-translations.yml` | Avisa tradutores quando uma traducao e aprovada |
| `translate.yml` | Automatiza traducoes |
| `label-approved.yml`, `add-to-project.yml`, `issue-manager.yml` | Rotula, organiza e fecha issues/PRs |
| `sponsors.yml`, `topic-repos.yml` | Atualizam dados exibidos na documentacao |
| `prepare-release.yml`, `create-draft-release.yml`, `publish.yml` | Fluxo de release |
| `zizmor.yml` | Analise de seguranca dos proprios workflows |

Detalhe de seguranca digno de nota: varios workflows declaram `permissions: {}`
no topo — negam tudo por padrao e concedem permissao apenas no job que precisa.

### Gatilhos

A variedade de gatilhos e o que mais chama atencao:

| Gatilho | Onde aparece | Para que |
| --- | --- | --- |
| `push` (branches: master) | `test.yml`, `build-docs.yml`, `zizmor.yml` | CI da branch principal |
| `pull_request` | maioria | Validacao de contribuicao |
| `pull_request_target` | `guard-dependencies.yml`, `notify-translations.yml`, `add-to-project.yml` | Precisa de token com escrita em PR de fork |
| `schedule` | `test.yml`, `sponsors.yml`, `label-approved.yml`, `translate.yml` | Execucao periodica |
| `workflow_run` | `deploy-docs.yml`, `smokeshow.yml` | Encadeia um workflow **depois** de outro terminar |
| `release` (published) | `publish.yml` | Publica no PyPI quando a release sai |
| `workflow_dispatch` | varios | Disparo manual |

O `workflow_run` e o caso mais interessante: `Deploy Docs` nao e disparado por
push, e sim pela conclusao do workflow `Build Docs`. E uma pipeline que dispara
outra pipeline.

### Historico

- Primeiro workflow: **27/11/2019** (`Add GitHub action Issue Manager`) — igual ao
  axios, a primeira automacao foi de gestao de issues, nao de teste.
- **343 commits** em `.github/workflows`, o maior volume dos tres.
- Atividade recente (2026): bumps agrupados de acoes, atualizacao do `setup-uv` e
  mudanca na forma de atualizar branches de traducao.

### Saida do analisador

```text
Workflow: Test  (test.yml)
Gatilhos: push [branches: master], pull_request, schedule
Jobs: 6  |  Passos: 41
Acoes: 8 (4 oficiais, 4 de terceiros, 8 com SHA fixo)
Achados: 2 (1 baixa, 1 info)
  [BAIXA] Sem controle de concorrencia
  [INFO]  Nao dispara em push na branch principal
```

---

## 3. caddyserver/caddy — servidor web em Go

### Caracteristicas

Nove workflows. O `ci.yml` tem **3 jobs e 18 passos**, com **5 acoes, todas
fixadas por SHA**. O que distingue o Caddy dos outros dois e a amplitude de
plataforma: o `cross-build.yml` compila o projeto para **dez sistemas
operacionais** em matriz — `aix`, `linux`, `solaris`, `illumos`, `dragonfly`,
`freebsd`, `openbsd`, `windows`, `darwin` e `netbsd` — com `fail-fast: false`,
para que a falha em um alvo nao cancele os demais.

O `ci.yml` ainda inclui um job `s390x-test`, que testa em arquitetura big-endian,
e um `goreleaser-check`, que valida a configuracao de release antes de precisar
dela.

### Funcionalidades

| Workflow | Funcao |
| --- | --- |
| `ci.yml` | Testes em matriz de SO/arquitetura + validacao do goreleaser |
| `cross-build.yml` | Compilacao cruzada para 10 sistemas operacionais |
| `lint.yml` | Analise estatica (golangci-lint) |
| `release.yml` | Build e publicacao dos binarios de release |
| `release_published.yml` | Acoes pos-release |
| `auto-release-pr.yml`, `release-proposal.yml` | Automatizam a abertura do PR de release |
| `scorecard.yml` | Roda o **OpenSSF Scorecard**, que pontua praticas de seguranca do repositorio |
| `ai.yml` | Automacao de triagem em issues e comentarios |

O `scorecard.yml` merece destaque: ele usa `step-security/harden-runner` para
restringir a rede do runner, roda a avaliacao da OpenSSF e envia o resultado em
formato SARIF para o **code scanning** do GitHub, integrando a pipeline com a
aba de seguranca do repositorio.

### Gatilhos

| Workflow | Gatilho |
| --- | --- |
| `ci.yml`, `cross-build.yml`, `lint.yml` | `push` e `pull_request` em `master` e `2.*` |
| `release.yml` | `push` em tags `v*.*.*` |
| `release_published.yml` | `release` (published) |
| `scorecard.yml` | `schedule`, `push`, `pull_request` e **`branch_protection_rule`** |
| `release-proposal.yml` | `workflow_dispatch` |
| `auto-release-pr.yml` | `pull_request_review`, `pull_request` (types: labeled, unlabeled, synchronize) |

O `branch_protection_rule` e um gatilho incomum: o Scorecard roda de novo sempre
que alguem mexe nas regras de protecao de branch, justamente porque isso afeta a
nota de seguranca.

### Historico

- Primeiro workflow: **20/03/2020**, com o commit `ci: Switch to Github Actions`
  (#3152) — ou seja, da para ver no historico a migracao de outro servico de CI
  para o GitHub Actions.
- **126 commits** em `.github/workflows`.
- Atividade recente (2026): atualizacao conjunta de acoes e modulos Go, remocao
  do `-v` dos testes e uma reversao do uso de `cosign` (assinatura de artefatos),
  o que mostra que nem toda tentativa de endurecer a pipeline se sustenta.

### Saida do analisador

```text
Workflow: Tests  (ci.yml)
Gatilhos: push [branches: master, 2.*], pull_request [branches: master, 2.*]
Jobs: 3  |  Passos: 18
Acoes: 5 (3 oficiais, 2 de terceiros, 5 com SHA fixo)
Achados: 3 (2 baixa, 1 info)
  [BAIXA] Job sem timeout
  [BAIXA] Sem controle de concorrencia
  [INFO]  Nao dispara em push na branch principal
```

---

## Comparacao

| | axios | fastapi | caddy |
| --- | --- | --- | --- |
| Linguagem | JavaScript | Python | Go |
| Workflows | 8 | 20 | 9 |
| Jobs no CI principal | 7 | 6 | 3 |
| Passos no CI principal | 46 | 41 | 18 |
| Acoes fixadas por SHA | 7/7 | 8/8 | 5/5 |
| Encadeamento (`needs`) | leque (1 → 6) | grafo com agregador | sem encadeamento |
| Matriz | 4 jobs | 1 job multidimensional | SO/arquitetura |
| Primeiro workflow | 18/06/2020 | 27/11/2019 | 20/03/2020 |
| Commits em workflows | 145 | 343 | 126 |
| Analise de seguranca | zizmor | zizmor | OpenSSF Scorecard |

### Padroes que os tres compartilham

**Fixacao por SHA.** Os tres fixam 100% das acoes por hash de commit, com a tag
anotada em comentario (`# v7.0.1`). E o ponto em que projetos grandes convergem:
tag e movel, hash nao e.

**Bot atualizando as acoes.** Como fixar por SHA congela a versao, os tres usam
Dependabot com agrupamento (`github-actions group`) para abrir PRs de atualizacao.
Fixar sem automatizar a atualizacao so troca um problema por outro.

**Analise da propria pipeline.** Dois usam `zizmor` e um usa `OpenSSF Scorecard`.
Ou seja, a pipeline virou artefato que merece revisao automatica — que e
exatamente a premissa do analisador construido neste projeto.

**Automacao alem do teste.** Nos tres, boa parte dos workflows cuida de release,
documentacao, rotulagem e moderacao. Nos dois casos mais antigos (axios e
fastapi), a primeira automacao adicionada nem foi de teste: foi gestao de issues.

### Onde os tres divergem

O gatilho do CI e a maior diferenca de filosofia. O axios so roda CI em
`pull_request`; o fastapi e o caddy rodam em `push` na branch principal **e** em
PR. Vale registrar que os tres usam `master` ou branches versionadas como
principal, e nao `main` — por isso a regra `sem-push-na-principal` do analisador
acusa `INFO` nos tres. O achado esta correto para o requisito da disciplina
(push na `main`), mas mostra que a regra precisa aceitar a branch principal
configurada, e nao assumir `main`. Foi uma limitacao encontrada rodando a
ferramenta em codigo real.

Os achados de `timeout` e `concurrency` tambem aparecem nos tres, o que sugere
que sao praticas recomendadas mas nao universais — inclusive em projetos maduros.

---

## O que foi trazido para a pipeline deste projeto

A analise nao ficou so no papel; tres coisas vieram para o `pipeline.yml` daqui:

1. **`concurrency` com `cancel-in-progress`** — os tres repositorios nao usam, e a
   propria ferramenta acusa isso. Aqui foi adotado, porque push seguido em
   trabalho de faculdade e comum e nao faz sentido manter execucao velha rodando.
2. **`timeout-minutes` em todos os jobs** — mesmo achado, mesma decisao.
3. **`permissions: contents: read` no topo** — seguindo o padrao de menor
   privilegio que o fastapi leva ao extremo com `permissions: {}`.

E a pratica que **nao** foi adotada, de proposito: fixar acoes por SHA. Em um
projeto de disciplina, sem Dependabot configurado, fixar hash deixaria as acoes
congeladas e desatualizadas. A ferramenta acusa isso como severidade `media`, e o
achado fica visivel no resumo do job — registrado como divida consciente, nao
como descuido.

---

## Fontes

- [axios/axios](https://github.com/axios/axios) — `.github/workflows/`
- [fastapi/fastapi](https://github.com/fastapi/fastapi) — `.github/workflows/`
- [caddyserver/caddy](https://github.com/caddyserver/caddy) — `.github/workflows/`
- [zizmor](https://github.com/zizmorcore/zizmor) — analisador estatico de seguranca para GitHub Actions
- [OpenSSF Scorecard](https://github.com/ossf/scorecard) — avaliacao automatizada de praticas de seguranca
