// "Vai, teia!": o clássico disparo de teia, sincronizado com o áudio (public/audio/vai-teia.wav).
// No "vai" ele se prepara (base firme, braço recolhido); no "teia" (~1,0 s) estica o braço direito
// com a mão no gesto do lançador (médio e anelar dobrados) e a teia sai do pulso.
// Formato das poses: ver dance.js. `thwip` = quanto o gesto do lançador está fechado (0..1) em cada mão.

import { poseFromTimeline } from './routine.js';

const SHOT_TIME = 1.0;

const NEUTRAL = {
	yaw: 0, lean: 0, roll: 0, twist: 0, neck: 0, head: 0, bob: 0,
	legs: { L: [ 0, - 0.05, 0 ], R: [ 0, - 0.05, 0 ] },
	hands: { L: [ 0.15, - 0.5, 0.12, 0 ], R: [ 0.15, - 0.5, 0.12, 0 ] },
	thwip: { L: 0, R: 0 },
};

// Base afastada e agachada, ombro direito para trás, mão direita recolhida perto do peito
const WINDUP = {
	yaw: - 0.25, lean: - 0.15, roll: 0, twist: - 0.15, neck: 0.05, head: 0.05, bob: 0,
	legs: { L: [ 0.4, - 0.55, 0 ], R: [ - 0.3, - 0.45, 0.25 ] },
	hands: { L: [ 0.22, - 0.36, 0.06, 0 ], R: [ 0.12, - 0.2, - 0.22, 0 ] },
	thwip: { L: 0, R: 0.6 },
};

// Braço direito esticado para a frente, na altura do ombro; a outra mão na cintura
const SHOOT = {
	yaw: 0.35, lean: - 0.1, roll: 0, twist: 0.2, neck: 0, head: 0, bob: 0,
	legs: { L: [ 0.45, - 0.5, 0 ], R: [ - 0.35, - 0.4, 0.3 ] },
	hands: { L: [ 0.22, - 0.36, 0.06, 0 ], R: [ 0.02, 0.04, - 0.75, 0 ] },
	thwip: { L: 0, R: 1 },
};

const timeline = [
	[ 0.0, NEUTRAL ],
	[ 0.4, WINDUP ],
	[ 0.85, { ...WINDUP, lean: - 0.2, legs: { L: [ 0.45, - 0.65, 0 ], R: [ - 0.35, - 0.5, 0.3 ] } } ],
	[ SHOT_TIME, SHOOT ],
	[ 1.6, SHOOT ],
	[ 2.1, NEUTRAL ],
];

export const VAI_TEIA = {
	duration: 2.1,
	pose: poseFromTimeline( timeline ),
	events: [ { t: SHOT_TIME, name: 'web' } ],
};
