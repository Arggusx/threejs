import * as THREE from 'three';
import { autoRig, segmentDistance } from './autoRig.js';

// O modelo (Disney Infinity) é uma estátua em pose "A", sem esqueleto. As posições abaixo foram
// medidas na malha (unidades do modelo: ~1,09 de altura, olhando para +Z, esquerda dela = +X).
// A cabeça é enorme: começa em ~0,42; o tronco vai de 0,19 a 0,42.
const J = {
	Hips: [ 0, 0.22, 0.02 ],
	Spine: [ 0, 0.27, 0.02 ],
	Spine1: [ 0, 0.32, 0.02 ],
	Spine2: [ 0, 0.37, 0.01 ],
	Neck: [ 0, 0.41, 0 ],
	Head: [ 0, 0.44, 0 ],
	HeadTop: [ 0, 1.0, 0 ],
	LeftArm: [ 0.11, 0.38, 0.01 ],
	LeftForeArm: [ 0.2, 0.32, 0.02 ],
	LeftHand: [ 0.28, 0.27, 0.02 ],
	LeftHandTip: [ 0.34, 0.235, 0.02 ],
	LeftUpLeg: [ 0.055, 0.2, 0.02 ],
	LeftLeg: [ 0.06, 0.11, 0.015 ],
	LeftFoot: [ 0.062, 0.05, 0 ],
	LeftToeBase: [ 0.062, 0.012, 0.07 ],
};
for ( const [ name, [ x, y, z ] ] of Object.entries( J ) ) if ( name.startsWith( 'Left' ) ) J[ name.replace( 'Left', 'Right' ) ] = [ - x, y, z ];

const PARENTS = {
	Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck', HeadTop: 'Head',
};
for ( const side of [ 'Left', 'Right' ] ) {

	Object.assign( PARENTS, {
		[ `${ side }Arm` ]: 'Spine2', [ `${ side }ForeArm` ]: `${ side }Arm`, [ `${ side }Hand` ]: `${ side }ForeArm`, [ `${ side }HandTip` ]: `${ side }Hand`,
		[ `${ side }UpLeg` ]: 'Hips', [ `${ side }Leg` ]: `${ side }UpLeg`, [ `${ side }Foot` ]: `${ side }Leg`, [ `${ side }ToeBase` ]: `${ side }Foot`,
	} );

}

const P = Object.fromEntries( Object.entries( J ).map( ( [ k, v ] ) => [ k, new THREE.Vector3( ...v ) ] ) );

// Segmentos (osso → do joint dele até o filho) que cada região do corpo pode usar.
const seg = ( bone, to ) => ( { bone, a: P[ bone ], b: P[ to ] } );
const TORSO = [ seg( 'Hips', 'Spine' ), seg( 'Spine', 'Spine1' ), seg( 'Spine1', 'Spine2' ), seg( 'Spine2', 'Neck' ) ];
const REGIONS = {};
for ( const side of [ 'Left', 'Right' ] ) {

	REGIONS[ `${ side }Arm` ] = [ seg( `${ side }Arm`, `${ side }ForeArm` ), seg( `${ side }ForeArm`, `${ side }Hand` ), seg( `${ side }Hand`, `${ side }HandTip` ), seg( 'Spine2', 'Neck' ) ];
	REGIONS[ `${ side }Leg` ] = [ seg( `${ side }UpLeg`, `${ side }Leg` ), seg( `${ side }Leg`, `${ side }Foot` ), seg( `${ side }Foot`, `${ side }ToeBase` ) ];

}

function weigh( v ) {

	if ( v.y >= 0.42 ) return [ [ 'Head', 1 ] ];

	let segments;
	if ( v.y < 0.19 ) segments = REGIONS[ v.x >= 0 ? 'LeftLeg' : 'RightLeg' ];
	else if ( Math.abs( v.x ) > 0.125 && v.y > 0.22 ) segments = REGIONS[ v.x >= 0 ? 'LeftArm' : 'RightArm' ];
	else segments = TORSO;

	// Peso pelo inverso da distância a cada segmento; os dois mais próximos dividem o vértice.
	return segments
		.map( ( s ) => [ s.bone, 1 / ( segmentDistance( v, s.a, s.b ) ** 4 + 1e-8 ) ] )
		.sort( ( x, y ) => y[ 1 ] - x[ 1 ] )
		.slice( 0, 2 );

}

export const vanellope = {

	id: 'vanellope',
	name: 'Vanellope',
	subtitle: 'a pé',
	url: './models/vanellope/vanellope.glb',
	height: 1.2,
	eyeForward: 0.2,
	eyeUp: 0.2,
	prepare: ( scene ) => autoRig( scene, { joints: J, parents: PARENTS, weigh } ),

};
