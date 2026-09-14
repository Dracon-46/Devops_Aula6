/**
 * Testes das regras do jokenpo.
 *
 * Tudo aqui roda sem navegador: `src/jogo.js` nao toca no DOM, entao o runner
 * da pipeline consegue exercitar o jogo inteiro.
 */

import { describe, expect, it } from 'vitest';

import {
  JOGADAS,
  VENCE_DE,
  aproveitamento,
  contarJogadas,
  contraJogada,
  jogadaDoComputador,
  jogadaMaisUsada,
  jogarRodada,
  novoPlacar,
  registrar,
  vencedor,
} from '../src/jogo.js';

/** Sorteio determinístico: devolve sempre o mesmo valor. */
function sorteioFixo(valor) {
  return () => valor;
}

describe('constantes', () => {
  it('tem exatamente as tres jogadas classicas', () => {
    expect(JOGADAS).toEqual(['pedra', 'papel', 'tesoura']);
  });

  it('monta um ciclo fechado: cada jogada derrota exatamente uma outra', () => {
    const derrotadas = JOGADAS.map((jogada) => VENCE_DE[jogada]);
    expect(new Set(derrotadas).size).toBe(3);
  });

  it('nenhuma jogada derrota a si mesma', () => {
    for (const jogada of JOGADAS) {
      expect(VENCE_DE[jogada]).not.toBe(jogada);
    }
  });
});

describe('vencedor', () => {
  it('empata quando as duas jogadas sao iguais', () => {
    for (const jogada of JOGADAS) {
      expect(vencedor(jogada, jogada)).toBe('empate');
    }
  });

  it('pedra ganha de tesoura', () => {
    expect(vencedor('pedra', 'tesoura')).toBe('jogador');
  });

  it('papel ganha de pedra', () => {
    expect(vencedor('papel', 'pedra')).toBe('jogador');
  });

  it('tesoura ganha de papel', () => {
    expect(vencedor('tesoura', 'papel')).toBe('jogador');
  });

  it('tesoura perde para pedra', () => {
    expect(vencedor('tesoura', 'pedra')).toBe('computador');
  });

  it('pedra perde para papel', () => {
    expect(vencedor('pedra', 'papel')).toBe('computador');
  });

  it('papel perde para tesoura', () => {
    expect(vencedor('papel', 'tesoura')).toBe('computador');
  });

  it('cobre as nove combinacoes possiveis sem sobrar caso indefinido', () => {
    const resultados = [];
    for (const jogador of JOGADAS) {
      for (const computador of JOGADAS) {
        resultados.push(vencedor(jogador, computador));
      }
    }
    expect(resultados).toHaveLength(9);
    expect(resultados.filter((r) => r === 'empate')).toHaveLength(3);
    expect(resultados.filter((r) => r === 'jogador')).toHaveLength(3);
    expect(resultados.filter((r) => r === 'computador')).toHaveLength(3);
  });

  it('recusa jogada invalida do jogador', () => {
    expect(() => vencedor('lagarto', 'pedra')).toThrow(RangeError);
  });

  it('recusa jogada invalida do computador', () => {
    expect(() => vencedor('pedra', 'spock')).toThrow(RangeError);
  });

  it('recusa valores vazios ou de outro tipo', () => {
    expect(() => vencedor('', 'pedra')).toThrow(RangeError);
    expect(() => vencedor(undefined, 'pedra')).toThrow(RangeError);
    expect(() => vencedor('pedra', null)).toThrow(RangeError);
  });
});

describe('contarJogadas', () => {
  it('devolve tudo zerado para historico vazio', () => {
    expect(contarJogadas([])).toEqual({ pedra: 0, papel: 0, tesoura: 0 });
  });

  it('conta as repeticoes de cada jogada', () => {
    const historico = ['pedra', 'pedra', 'tesoura', 'papel', 'pedra'];
    expect(contarJogadas(historico)).toEqual({
      pedra: 3,
      papel: 1,
      tesoura: 1,
    });
  });

  it('ignora entradas que nao sao jogadas validas', () => {
    expect(contarJogadas(['pedra', 'lagarto', 'pedra'])).toEqual({
      pedra: 2,
      papel: 0,
      tesoura: 0,
    });
  });
});

describe('jogadaMaisUsada', () => {
  it('devolve null quando nao ha historico', () => {
    expect(jogadaMaisUsada([])).toBeNull();
  });

  it('encontra a jogada mais repetida', () => {
    expect(jogadaMaisUsada(['papel', 'papel', 'pedra'])).toBe('papel');
    expect(jogadaMaisUsada(['tesoura', 'tesoura', 'tesoura'])).toBe('tesoura');
  });

  it('desempata pela ordem de JOGADAS, de forma deterministica', () => {
    // pedra e papel aparecem uma vez cada; pedra vem antes em JOGADAS.
    expect(jogadaMaisUsada(['papel', 'pedra'])).toBe('pedra');
    expect(jogadaMaisUsada(['tesoura', 'papel'])).toBe('papel');
  });

  it('nao depende da ordem em que as jogadas apareceram', () => {
    const a = jogadaMaisUsada(['pedra', 'papel', 'papel']);
    const b = jogadaMaisUsada(['papel', 'papel', 'pedra']);
    expect(a).toBe(b);
  });
});

describe('contraJogada', () => {
  it('devolve a jogada que derrota a informada', () => {
    expect(contraJogada('pedra')).toBe('papel');
    expect(contraJogada('papel')).toBe('tesoura');
    expect(contraJogada('tesoura')).toBe('pedra');
  });

  it('recusa jogada invalida', () => {
    expect(() => contraJogada('lagarto')).toThrow(RangeError);
    expect(() => contraJogada(null)).toThrow(RangeError);
  });
});

describe('jogadaDoComputador', () => {
  it('sorteia nas tres primeiras rodadas, sem olhar o historico', () => {
    expect(jogadaDoComputador([], sorteioFixo(0))).toBe('pedra');
    expect(jogadaDoComputador(['pedra'], sorteioFixo(0.5))).toBe('papel');
    expect(jogadaDoComputador(['pedra', 'pedra'], sorteioFixo(0.9))).toBe(
      'tesoura',
    );
  });

  it('cobre as tres jogadas conforme o valor sorteado', () => {
    const sorteados = [0, 0.34, 0.67].map((v) =>
      jogadaDoComputador([], sorteioFixo(v)),
    );
    expect(new Set(sorteados).size).toBe(3);
  });

  it('a partir da quarta rodada responde ao padrao do jogador', () => {
    // Jogador repetiu pedra: o computador deve vir de papel.
    const historico = ['pedra', 'pedra', 'pedra'];
    expect(jogadaDoComputador(historico, sorteioFixo(0))).toBe('papel');
  });

  it('le o padrao mesmo que o sorteio devolvesse outra coisa', () => {
    const historico = ['tesoura', 'tesoura', 'papel', 'tesoura'];
    // Preferida e tesoura; quem ganha de tesoura e pedra.
    expect(jogadaDoComputador(historico, sorteioFixo(0.99))).toBe('pedra');
  });

  it('usa Math.random por padrao e devolve sempre jogada valida', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(JOGADAS).toContain(jogadaDoComputador([]));
    }
  });
});

describe('novoPlacar', () => {
  it('comeca tudo zerado', () => {
    expect(novoPlacar()).toEqual({
      jogador: 0,
      computador: 0,
      empates: 0,
      rodadas: 0,
      historico: [],
    });
  });

  it('devolve um objeto novo a cada chamada', () => {
    const a = novoPlacar();
    const b = novoPlacar();
    expect(a).not.toBe(b);
    expect(a.historico).not.toBe(b.historico);
  });
});

describe('registrar', () => {
  it('soma ponto para o jogador quando ele ganha', () => {
    const { placar, resultado } = registrar(novoPlacar(), 'pedra', 'tesoura');
    expect(resultado).toBe('jogador');
    expect(placar.jogador).toBe(1);
    expect(placar.computador).toBe(0);
    expect(placar.empates).toBe(0);
    expect(placar.rodadas).toBe(1);
  });

  it('soma ponto para o computador quando ele ganha', () => {
    const { placar, resultado } = registrar(novoPlacar(), 'pedra', 'papel');
    expect(resultado).toBe('computador');
    expect(placar.computador).toBe(1);
    expect(placar.jogador).toBe(0);
  });

  it('conta empate sem dar ponto a ninguem', () => {
    const { placar, resultado } = registrar(novoPlacar(), 'papel', 'papel');
    expect(resultado).toBe('empate');
    expect(placar.empates).toBe(1);
    expect(placar.jogador).toBe(0);
    expect(placar.computador).toBe(0);
  });

  it('guarda a jogada do jogador no historico', () => {
    const { placar } = registrar(novoPlacar(), 'tesoura', 'papel');
    expect(placar.historico).toEqual(['tesoura']);
  });

  it('nao modifica o placar recebido', () => {
    const antes = novoPlacar();
    registrar(antes, 'pedra', 'tesoura');
    expect(antes).toEqual(novoPlacar());
  });

  it('acumula ao longo de varias rodadas', () => {
    let placar = novoPlacar();
    placar = registrar(placar, 'pedra', 'tesoura').placar; // ganha
    placar = registrar(placar, 'pedra', 'papel').placar; // perde
    placar = registrar(placar, 'pedra', 'pedra').placar; // empata

    expect(placar).toEqual({
      jogador: 1,
      computador: 1,
      empates: 1,
      rodadas: 3,
      historico: ['pedra', 'pedra', 'pedra'],
    });
  });

  it('propaga o erro de jogada invalida', () => {
    expect(() => registrar(novoPlacar(), 'lagarto', 'pedra')).toThrow(
      RangeError,
    );
  });
});

describe('jogarRodada', () => {
  it('devolve a jogada escolhida pelo computador', () => {
    const { jogadaComputador } = jogarRodada(
      novoPlacar(),
      'pedra',
      sorteioFixo(0),
    );
    expect(jogadaComputador).toBe('pedra');
  });

  it('resolve a rodada de ponta a ponta', () => {
    // sorteio 0 -> computador joga pedra; jogador de papel ganha.
    const { placar, resultado, jogadaComputador } = jogarRodada(
      novoPlacar(),
      'papel',
      sorteioFixo(0),
    );
    expect(jogadaComputador).toBe('pedra');
    expect(resultado).toBe('jogador');
    expect(placar.jogador).toBe(1);
    expect(placar.rodadas).toBe(1);
  });

  it('nao modifica o placar recebido', () => {
    const antes = novoPlacar();
    jogarRodada(antes, 'pedra', sorteioFixo(0));
    expect(antes).toEqual(novoPlacar());
  });

  it('passa a punir quem repete a mesma jogada', () => {
    let placar = novoPlacar();
    // Tres rodadas de aquecimento repetindo pedra.
    for (let i = 0; i < 3; i += 1) {
      placar = jogarRodada(placar, 'pedra', sorteioFixo(0)).placar;
    }
    // Da quarta em diante o computador vem de papel e ganha.
    const rodada = jogarRodada(placar, 'pedra', sorteioFixo(0));
    expect(rodada.jogadaComputador).toBe('papel');
    expect(rodada.resultado).toBe('computador');
  });

  it('mantem uma partida longa consistente', () => {
    let placar = novoPlacar();
    const sequencia = ['pedra', 'papel', 'tesoura', 'papel', 'pedra', 'papel'];

    for (const jogada of sequencia) {
      placar = jogarRodada(placar, jogada, sorteioFixo(0.5)).placar;
    }

    expect(placar.rodadas).toBe(sequencia.length);
    expect(placar.jogador + placar.computador + placar.empates).toBe(
      sequencia.length,
    );
    expect(placar.historico).toEqual(sequencia);
  });
});

describe('aproveitamento', () => {
  it('e zero antes de qualquer rodada decidida', () => {
    expect(aproveitamento(novoPlacar())).toBe(0);
  });

  it('ignora os empates na conta', () => {
    const placar = { ...novoPlacar(), jogador: 1, computador: 1, empates: 8 };
    expect(aproveitamento(placar)).toBe(50);
  });

  it('chega a 100 quando o jogador nunca perdeu', () => {
    const placar = { ...novoPlacar(), jogador: 4, computador: 0 };
    expect(aproveitamento(placar)).toBe(100);
  });

  it('chega a 0 quando o jogador nunca ganhou', () => {
    const placar = { ...novoPlacar(), jogador: 0, computador: 3 };
    expect(aproveitamento(placar)).toBe(0);
  });

  it('fica sempre entre 0 e 100', () => {
    const placar = { ...novoPlacar(), jogador: 7, computador: 13 };
    const valor = aproveitamento(placar);
    expect(valor).toBeGreaterThanOrEqual(0);
    expect(valor).toBeLessThanOrEqual(100);
  });
});
