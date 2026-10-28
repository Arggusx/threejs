import { poseFromTimeline } from './routine.js';

// Comemoração da Vanellope: agacha, pula com os braços para cima e soca o ar duas vezes.
// `lift` levanta o corpo (metros) durante o pulo.
const NEUTRAL = {
	yaw: 0, lean: 0, roll: 0, twist: 0, neck: 0, head: 0, lift: 0,
	legs: { L: [ 0, - 0.05, 0 ], R: [ 0, - 0.05, 0 ] },
	hands: { L: [ 0.15, - 0.5, 0.12, 0 ], R: [ 0.15, - 0.5, 0.12, 0 ] },
};

const CROUCH = {
	...NEUTRAL, lean: 0.25, neck: - 0.1,
	legs: { L: [ 0.6, - 1.1, 0.5 ], R: [ 0.6, - 1.1, 0.5 ] },
	hands: { L: [ 0.2, - 0.3, - 0.2, 0 ], R: [ 0.2, - 0.3, - 0.2, 0 ] },
};

const JUMP = {
	...NEUTRAL, lean: - 0.15, neck: - 0.2, head: - 0.15, lift: 0.45,
	legs: { L: [ 0.3, - 0.6, 0.3 ], R: [ 0.1, - 0.9, 0.4 ] },
	hands: { L: [ 0.2, 0.6, 0, 0 ], R: [ 0.2, 0.6, 0, 0 ] },
};

const PUMP_UP = {
	...NEUTRAL, yaw: 0.2, twist: 0.15, neck: - 0.1,
	legs: { L: [ 0.1, - 0.2, 0 ], R: [ - 0.1, - 0.1, 0 ] },
	hands: { L: [ 0.2, - 0.4, 0.1, 0 ], R: [ 0.1, 0.6, - 0.05, 0 ] },
};

const PUMP_DOWN = {
	...PUMP_UP, lean: 0.1,
	hands: { L: [ 0.2, - 0.4, 0.1, 0 ], R: [ 0.15, 0.05, - 0.2, 0 ] },
};

const timeline = [
	[ 0.0, NEUTRAL ],
	[ 0.3, CROUCH ],
	[ 0.55, JUMP ],
	[ 0.75, { ...JUMP, lift: 0.5 } ],
	[ 0.95, CROUCH ],
	[ 1.2, PUMP_UP ],
	[ 1.4, PUMP_DOWN ],
	[ 1.6, PUMP_UP ],
	[ 1.8, PUMP_DOWN ],
	[ 2.3, NEUTRAL ],
];

export const CELEBRATE = {
	duration: 2.3,
	pose: poseFromTimeline( timeline ),
};
