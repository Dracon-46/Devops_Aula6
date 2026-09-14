/**
 * Camada de tela do jokenpo.
 *
 * Este arquivo cuida só do navegador: lê cliques, desenha o resultado e guarda
 * o recorde. Nenhuma regra do jogo mora aqui — todas vêm de `jogo.js`, que é
 * puro e por isso testável dentro da pipeline.
 */

import {
  JOGADAS,
  aproveitamento,
  jogarRodada,
  novoPlacar,
} from './jogo.js';

const CHAVE_RECORDE = 'jokenpo-recorde';

/** Emoji de cada jogada, só para a tela. */
const EMOJI = {
  pedra: '✊',
  papel: '✋',
  tesoura: '✌️',
};

/** Texto mostrado para cada resultado. */
const FRASE = {
  jogador: 'Você venceu a rodada',
  computador: 'O computador venceu',
  empate: 'Empate',
};

const estado = {
  placar: novoPlacar(),
  recorde: 0,
  animando: false,
};

const tela = {};

function pegarElementos() {
  tela.botoes = Array.from(document.querySelectorAll('[data-jogada]'));
  tela.maoJogador = document.querySelector('#mao-jogador');
  tela.maoComputador = document.querySelector('#mao-computador');
  tela.resultado = document.querySelector('#resultado');
  tela.detalhe = document.querySelector('#detalhe');
  tela.pontosJogador = document.querySelector('#pontos-jogador');
  tela.pontosComputador = document.querySelector('#pontos-computador');
  tela.empates = document.querySelector('#empates');
  tela.rodadas = document.querySelector('#rodadas');
  tela.aproveitamento = document.querySelector('#aproveitamento');
  tela.recorde = document.querySelector('#recorde');
  tela.reiniciar = document.querySelector('#reiniciar');
  tela.placar = document.querySelector('#placar');
}

function lerRecorde() {
  try {
    const salvo = Number(localStorage.getItem(CHAVE_RECORDE));
    return Number.isFinite(salvo) && salvo > 0 ? salvo : 0;
  } catch {
    // Navegador com armazenamento bloqueado: o jogo continua, só sem recorde.
    return 0;
  }
}

function salvarRecorde(valor) {
  try {
    localStorage.setItem(CHAVE_RECORDE, String(valor));
  } catch {
    // Sem armazenamento, segue o jogo.
  }
}

function desenharPlacar() {
  const { placar } = estado;

  tela.pontosJogador.textContent = String(placar.jogador);
  tela.pontosComputador.textContent = String(placar.computador);
  tela.empates.textContent = String(placar.empates);
  tela.rodadas.textContent = String(placar.rodadas);
  tela.aproveitamento.textContent = `${Math.round(aproveitamento(placar))}%`;
  tela.recorde.textContent = String(estado.recorde);
}

function mostrarResultado(resultado, jogadaJogador, jogadaComputador) {
  tela.maoJogador.textContent = EMOJI[jogadaJogador];
  tela.maoComputador.textContent = EMOJI[jogadaComputador];

  tela.resultado.textContent = FRASE[resultado];
  tela.resultado.dataset.resultado = resultado;
  tela.detalhe.textContent = `${jogadaJogador} contra ${jogadaComputador}`;
}

function animarMaos() {
  for (const mao of [tela.maoJogador, tela.maoComputador]) {
    mao.classList.remove('sacudindo');
    // Força o navegador a reiniciar a animação.
    void mao.offsetWidth;
    mao.classList.add('sacudindo');
  }
}

function jogar(jogadaJogador) {
  if (estado.animando || !JOGADAS.includes(jogadaJogador)) {
    return;
  }

  estado.animando = true;
  tela.resultado.textContent = 'Jo... ken... pô!';
  tela.resultado.dataset.resultado = 'aguardando';
  tela.detalhe.textContent = '';
  tela.maoJogador.textContent = EMOJI.pedra;
  tela.maoComputador.textContent = EMOJI.pedra;
  animarMaos();

  window.setTimeout(() => {
    const { placar, resultado, jogadaComputador } = jogarRodada(
      estado.placar,
      jogadaJogador,
    );

    estado.placar = placar;

    if (placar.jogador > estado.recorde) {
      estado.recorde = placar.jogador;
      salvarRecorde(estado.recorde);
      tela.placar.classList.add('novo-recorde');
    }

    mostrarResultado(resultado, jogadaJogador, jogadaComputador);
    desenharPlacar();
    estado.animando = false;
  }, 600);
}

function reiniciar() {
  estado.placar = novoPlacar();
  estado.animando = false;
  tela.placar.classList.remove('novo-recorde');
  tela.maoJogador.textContent = EMOJI.pedra;
  tela.maoComputador.textContent = EMOJI.pedra;
  tela.resultado.textContent = 'Escolha sua jogada';
  tela.resultado.dataset.resultado = 'aguardando';
  tela.detalhe.textContent = 'O computador começa sorteando.';
  desenharPlacar();
}

function ligarControles() {
  for (const botao of tela.botoes) {
    botao.addEventListener('click', () => jogar(botao.dataset.jogada));
  }

  tela.reiniciar.addEventListener('click', reiniciar);

  // Atalhos de teclado: 1/2/3 ou as iniciais.
  const porTecla = {
    1: 'pedra',
    2: 'papel',
    3: 'tesoura',
    p: 'pedra',
    a: 'papel',
    t: 'tesoura',
  };

  window.addEventListener('keydown', (evento) => {
    const jogada = porTecla[evento.key.toLowerCase()];
    if (jogada) {
      evento.preventDefault();
      jogar(jogada);
    }
  });
}

function iniciar() {
  pegarElementos();
  estado.recorde = lerRecorde();
  ligarControles();
  reiniciar();
}

iniciar();
