/**
 * Regras do jokenpô.
 *
 * Só lógica pura: nenhuma função toca no DOM. É o que permite testar o jogo
 * inteiro sem navegador, dentro do runner da pipeline.
 */

/** As três jogadas válidas. */
export const JOGADAS = ['pedra', 'papel', 'tesoura'];

/** Quem cada jogada derrota. Pedra quebra tesoura, e assim por diante. */
export const VENCE_DE = {
  pedra: 'tesoura',
  papel: 'pedra',
  tesoura: 'papel',
};

/**
 * Decide o resultado de uma rodada.
 *
 * @param {string} jogador jogada do jogador
 * @param {string} computador jogada do computador
 * @returns {'jogador'|'computador'|'empate'}
 */
export function vencedor(jogador, computador) {
  if (!JOGADAS.includes(jogador) || !JOGADAS.includes(computador)) {
    throw new RangeError(`jogada invalida: ${jogador} x ${computador}`);
  }
  if (jogador === computador) {
    return 'empate';
  }
  return VENCE_DE[jogador] === computador ? 'jogador' : 'computador';
}

/**
 * Conta quantas vezes o jogador usou cada jogada.
 *
 * @param {string[]} historico jogadas do jogador, da mais antiga para a mais nova
 * @returns {Record<string, number>}
 */
export function contarJogadas(historico) {
  const contagem = { pedra: 0, papel: 0, tesoura: 0 };
  for (const jogada of historico) {
    if (JOGADAS.includes(jogada)) {
      contagem[jogada] += 1;
    }
  }
  return contagem;
}

/**
 * Jogada mais repetida pelo jogador. Em caso de empate, vence a ordem de
 * `JOGADAS` — assim a função é determinística e dá para testar.
 *
 * @param {string[]} historico
 * @returns {string|null} null se o histórico estiver vazio
 */
export function jogadaMaisUsada(historico) {
  const contagem = contarJogadas(historico);
  let escolhida = null;
  let maior = 0;

  for (const jogada of JOGADAS) {
    if (contagem[jogada] > maior) {
      maior = contagem[jogada];
      escolhida = jogada;
    }
  }

  return escolhida;
}

/**
 * Escolhe a jogada do computador.
 *
 * Nas primeiras rodadas ele joga aleatório. Depois de três rodadas, passa a
 * ler o padrão: aposta que você vai repetir sua jogada preferida e escolhe
 * justamente a que ganha dela. É o suficiente para o jogo parar de parecer
 * um sorteio e começar a punir quem fica repetindo.
 *
 * @param {string[]} historico jogadas anteriores do jogador
 * @param {() => number} sorteio função que devolve [0, 1)
 * @returns {string}
 */
export function jogadaDoComputador(historico = [], sorteio = Math.random) {
  const MINIMO_PARA_LER_PADRAO = 3;

  if (historico.length < MINIMO_PARA_LER_PADRAO) {
    return JOGADAS[Math.floor(sorteio() * JOGADAS.length)];
  }

  const preferida = jogadaMaisUsada(historico);
  return contraJogada(preferida);
}

/**
 * Devolve a jogada que derrota a jogada informada.
 *
 * @param {string} jogada
 * @returns {string}
 */
export function contraJogada(jogada) {
  const resposta = JOGADAS.find((candidata) => VENCE_DE[candidata] === jogada);
  if (!resposta) {
    throw new RangeError(`jogada invalida: ${jogada}`);
  }
  return resposta;
}

/** Placar zerado. */
export function novoPlacar() {
  return { jogador: 0, computador: 0, empates: 0, rodadas: 0, historico: [] };
}

/**
 * Registra uma rodada e devolve o novo placar.
 *
 * O placar recebido não é modificado — cada rodada gera um estado novo, o que
 * deixa o teste simples e evita bug de estado compartilhado.
 *
 * @param {object} placar estado atual
 * @param {string} jogadaJogador
 * @param {string} jogadaComputador
 * @returns {{placar: object, resultado: string}}
 */
export function registrar(placar, jogadaJogador, jogadaComputador) {
  const resultado = vencedor(jogadaJogador, jogadaComputador);

  const novo = {
    jogador: placar.jogador + (resultado === 'jogador' ? 1 : 0),
    computador: placar.computador + (resultado === 'computador' ? 1 : 0),
    empates: placar.empates + (resultado === 'empate' ? 1 : 0),
    rodadas: placar.rodadas + 1,
    historico: [...placar.historico, jogadaJogador],
  };

  return { placar: novo, resultado };
}

/**
 * Joga uma rodada completa: o computador escolhe, compara e atualiza o placar.
 *
 * @param {object} placar estado atual
 * @param {string} jogadaJogador
 * @param {() => number} sorteio
 * @returns {{placar: object, resultado: string, jogadaComputador: string}}
 */
export function jogarRodada(placar, jogadaJogador, sorteio = Math.random) {
  const jogadaComputador = jogadaDoComputador(placar.historico, sorteio);
  const { placar: novo, resultado } = registrar(
    placar,
    jogadaJogador,
    jogadaComputador,
  );

  return { placar: novo, resultado, jogadaComputador };
}

/**
 * Aproveitamento do jogador, em percentual das rodadas não empatadas.
 *
 * @param {object} placar
 * @returns {number} 0 a 100
 */
export function aproveitamento(placar) {
  const decididas = placar.jogador + placar.computador;
  if (decididas === 0) {
    return 0;
  }
  return (placar.jogador / decididas) * 100;
}
