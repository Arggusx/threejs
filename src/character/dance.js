// Dança do meme do Homem-Aranha (desenho de 1967), copiada quadro a quadro do vídeo de referência.
// Ritmo: um ciclo a cada 0,8 s (dois passos de 0,4 s).
//
// Cada pose tem ângulos em radianos, no espaço do personagem (frente = -Z):
//   yaw   giro do corpo inteiro no quadril     lean  tronco (+ = para trás, - = curvado para a frente)
//   roll  tronco tombando de lado (+ = para a esquerda)
//   twist torção dos ombros contra o quadril   neck/head  pescoço/cabeça (+ = olhando para cima)
//   O corpo não tem velocidade própria: ele avança porque o pé apoiado fica travado no chão
//   (Character.js), então as pernas de apoio vão de frente para trás, como numa caminhada.
//   legs.L/R  [coxa (+ = para a frente), joelho (- = dobra), pé]
//   hands.L/R [fora, cima, frente/trás (+ = para trás), queixo 0..1] — posição da mão em relação ao ombro;
//             com "queixo" = 1 a mão vai até o queixo (o gesto de "pensando/estilo" do vídeo)

import { poseFromTimeline } from './routine.js';

const DANCE_DURATION = 6.7;

const pose = ( base, changes ) => ( { ...base, ...changes } );

// ---------------------------------------------------------------- parte 1 (0 – 3 s)
// Anda "se achando": peito para fora, cabeça virada para o céu, braços soltos um pouco para trás.
// O corpo gira de um lado para o outro a cada passo.

const ARMS_LOOSE = { L: [ 0.15, - 0.5, 0.15, 0 ], R: [ 0.15, - 0.5, 0.15, 0 ] };
const STAND = [ 0, - 0.05, 0 ];
const KICK = [ - 0.4, - 1.6, 0.5 ]; // calcanhar chutado para trás

const STRUT = {
	yaw: - 0.3, lean: 0.3, roll: 0, twist: 0, neck: 0.55, head: 0.45, bob: 0,
	legs: { L: STAND, R: KICK }, hands: ARMS_LOOSE,
};

const strutCycle = [
	// pé direito chutado para trás, corpo virado para a direita
	[ 0.0, STRUT ],
	[ 0.25, pose( STRUT, { bob: - 0.015, legs: { L: [ 0, - 0.12, 0 ], R: KICK } } ) ],
	// passo largo para a frente, tronco vai junto e a mão esquerda vai ao queixo; corpo vira para a esquerda
	[ 0.4, pose( STRUT, {
		yaw: 0.3, lean: - 0.05, twist: 0.2, neck: 0.35, head: 0.3, bob: - 0.07,
		legs: { L: [ - 0.45, - 0.35, 0.55 ], R: [ 0.5, - 0.2, - 0.1 ] },
		hands: { L: [ 0, 0, 0, 1 ], R: [ 0.18, - 0.42, 0.28, 0 ] },
	} ) ],
	[ 0.5, pose( STRUT, {
		yaw: 0.3, lean: 0, twist: 0.2, neck: 0.4, head: 0.35, bob: - 0.06,
		legs: { L: [ - 0.4, - 0.45, 0.55 ], R: [ 0.4, - 0.2, - 0.1 ] },
		hands: { L: [ 0, 0, 0, 1 ], R: [ 0.18, - 0.42, 0.28, 0 ] },
	} ) ],
	// junta as pernas e chuta o pé de novo
	[ 0.6, pose( STRUT, { yaw: 0.05, legs: { L: KICK, R: STAND } } ) ],
	// pés juntos, de costas, girando para começar o próximo ciclo
	[ 0.75, pose( STRUT, {
		yaw: - 0.15, lean: 0.15, bob: 0.01,
		legs: { L: [ 0, - 0.1, 0 ], R: [ 0, - 0.05, 0 ] },
		hands: { L: [ 0.14, - 0.55, 0.08, 0 ], R: [ 0.14, - 0.55, 0.08, 0 ] },
	} ) ],
];

// ---------------------------------------------------------------- parte 2 (3,3 – 6,7 s)
// Trote "malandro": curvado para a frente, joelhos dobrados, cotovelos abertos balançando,
// calcanhares chutando bem para trás.

const JOG = { yaw: 0, lean: - 0.45, roll: 0, neck: - 0.1, head: - 0.1 };
const jogArms = ( forward ) => ( {
	L: [ 0.06, - 0.32, forward === 'L' ? - 0.32 : - 0.08, 0 ],
	R: [ 0.06, - 0.32, forward === 'R' ? - 0.32 : - 0.08, 0 ],
} );

const jogCycle = ( roll = 0, head = 0 ) => [
	[ 0.0, pose( JOG, { roll, head: JOG.head + head, twist: - 0.2, bob: - 0.09, legs: { L: [ 0.3, - 0.45, - 0.1 ], R: [ - 0.5, - 1.8, 0.55 ] }, hands: jogArms( 'L' ) } ) ],
	[ 0.2, pose( JOG, { roll, head: JOG.head + head, twist: 0, bob: - 0.05, legs: { L: [ - 0.25, - 0.3, 0.3 ], R: [ 0.35, - 0.6, 0 ] }, hands: jogArms( null ) } ) ],
	[ 0.4, pose( JOG, { roll, head: JOG.head + head, twist: 0.2, bob: - 0.09, legs: { L: [ - 0.5, - 1.8, 0.55 ], R: [ 0.3, - 0.45, - 0.1 ] }, hands: jogArms( 'R' ) } ) ],
	[ 0.6, pose( JOG, { roll, head: JOG.head + head, twist: 0, bob: - 0.05, legs: { L: [ 0.35, - 0.6, 0 ], R: [ - 0.25, - 0.3, 0.3 ] }, hands: jogArms( null ) } ) ],
];

// ---------------------------------------------------------------- linha do tempo

const timeline = [];
const repeat = ( cycle, start, count, period = 0.8 ) => {

	for ( let i = 0; i < count; i ++ ) for ( const [ t, p ] of cycle ) timeline.push( [ start + i * period + t, p ] );

};

repeat( strutCycle, 0, 3 ); // 0 – 2,4 s

// 2,4 – 2,9 s: segura a mão no queixo, cabeça bem para trás, pé chutado
const THINK = pose( STRUT, { yaw: 0.1, neck: 0.65, head: 0.5, hands: { L: [ 0, 0, 0, 1 ], R: [ 0.12, - 0.5, 0.18, 0 ] } } );
timeline.push( [ 2.4, THINK ] );
timeline.push( [ 2.85, pose( THINK, { legs: { L: STAND, R: [ - 0.2, - 0.9, 0.3 ] } } ) ] );

// 3,0 s: em pé, de costas, mãos na cintura, antes de sair trotando
timeline.push( [ 3.05, {
	yaw: 0, lean: - 0.1, roll: 0, twist: 0, neck: 0, head: 0, bob: 0,
	legs: { L: [ 0, 0, 0 ], R: [ 0, 0, 0 ] }, hands: { L: [ 0.2, - 0.38, 0.08, 0 ], R: [ 0.2, - 0.38, 0.08, 0 ] },
} ] );

repeat( jogCycle(), 3.3, 1 ); // 3,3 – 4,1 s: trote reto
repeat( jogCycle( 0.25, - 0.3 ), 4.1, 1 ); // 4,1 – 4,9 s: tomba de lado e olha para baixo (como no vídeo)
repeat( jogCycle(), 4.9, 2 ); // 4,9 – 6,5 s

timeline.push( [ DANCE_DURATION, {
	yaw: 0, lean: 0, roll: 0, twist: 0, neck: 0, head: 0, bob: 0,
	legs: { L: STAND, R: STAND }, hands: ARMS_LOOSE,
} ] );

export const DANCE = { duration: DANCE_DURATION, pose: poseFromTimeline( timeline ) };
