import * as THREE from 'three';

// Audi RS6 Avant 2020. This asset includes an authored four-door rig and
// DOOR OPEN / DOOR CLOSE clips, so its door geometry is never extracted.
const SCALE = 10;
const WHEELS = {
	fl: { wheel: 'Wheel_01_LF', caliper: 'CaliperLF' },
	fr: { wheel: 'Wheel_01_RF', caliper: 'CaliperRF' },
	rl: { wheel: 'Wheel_01_LR', caliper: 'CaliperLR' },
	rr: { wheel: 'Wheel_01_RR', caliper: 'CaliperRR' },
};

export const audi = {

	id: 'audi',
	name: 'Audi RS6',
	subtitle: 'Avant',
	url: './models/audi/audi.glb',

	wheelbase: 2.93,
	wheelRadius: 0.36,
	halfWidth: 1.06,
	halfLength: 2.5,
	shadowSize: [ 2.7, 5.5 ],
	headlight: { x: 0.72, y: 0.62, inset: 0.42 },
	cockpitEye: new THREE.Vector3( -0.14, 0.94, 0.15 ),
	spoilers: false,
	interiorTint: 0.72,
	defaults: { paint: '#293e68', rims: 'prata', calipers: '#d32727' },

	build( car, gltf ) {

		const model = gltf.scene;
		model.scale.setScalar( SCALE );
		model.rotation.y = Math.PI;
		model.getObjectByName( 'GROUND_PLANE' )?.removeFromParent();
		for ( const name of [ 'TYRE_SET_2_RL', 'TYRE_SET_2_FL', 'TYRE_SET_2_FR', 'TYRE_SET_2_RR', 'TYRE_SET_3_FL', 'TYRE_SET_3_RL', 'TYRE_SET_3_RR', 'TYRE_SET_3_FR' ] ) {

			model.getObjectByName( name )?.removeFromParent();

		}

		const root = new THREE.Group();
		root.add( model );
		car.root = root;
		car.object.add( root );
		root.updateMatrixWorld( true );

		applyMaterials( car );
		setupWheels( car, model );

		const body = model.getObjectByName( 'AUDI' );
		car.chassis = new THREE.Group();
		car.chassis.name = 'chassis';
		root.add( car.chassis );
		car.chassis.attach( body );
		root.updateMatrixWorld( true );

		car.bounds = localBox( car, car.chassis );
		setupSteering( car );
		setupDoorAnimations( car, gltf, model );

	},

	updateDoor( car, side, progress ) {

		const action = car.doorActions[ side ];
		action.time = action.getClip().duration * progress;
		action.enabled = true;
		action.paused = false;
		car.doorMixer.update( 0 );
		action.paused = true;

	},

};

function localBox( car, object ) {

	return new THREE.Box3().setFromObject( object ).applyMatrix4( car.root.matrixWorld.clone().invert() );

}

function applyMaterials( car ) {

	const m = car.materials;
	const paint = findMaterial( car.root, /^CarPaint1$/ );
	const glass = findMaterial( car.root, /^FRONT_WINDOW_GLASS$/ );
	const rim = findMaterial( car.root, /^ALLOY_WHEELS_TYPE_1$/ );
	const caliper = findMaterial( car.root, /^Calliper_Color1$/ );
	const interior = findMaterial( car.root, /^SEAT_COVER$/ );
	const headlight = findMaterial( car.root, /^MAIN_HEADLIGHT$/ );
	const taillight = findMaterial( car.root, /^BREAK_LIGHT$/ );
	const drl = findMaterial( car.root, /^MAINHEADLIGHT_FRONT_BACK$/ );

	if ( paint ) replaceMaterial( car.root, paint, m.body );
	if ( glass ) replaceMaterial( car.root, glass, m.glass );
	if ( rim ) replaceMaterial( car.root, rim, m.rims );
	if ( caliper ) replaceMaterial( car.root, caliper, m.caliper );

	m.leather = interior ? interior.clone() : new THREE.MeshStandardMaterial( { color: 0x252525, roughness: 0.82 } );
	if ( interior ) replaceMaterial( car.root, interior, m.leather );

	m.headlights = headlight ? headlight.clone() : new THREE.MeshStandardMaterial();
	m.taillights = taillight ? taillight.clone() : new THREE.MeshStandardMaterial();
	m.leds = drl ? drl.clone() : m.headlights.clone();
	m.rearLeds = m.taillights;
	if ( headlight ) replaceMaterial( car.root, headlight, m.headlights );
	if ( taillight ) replaceMaterial( car.root, taillight, m.taillights );
	if ( drl ) replaceMaterial( car.root, drl, m.leds );

}

function findMaterial( root, pattern ) {

	let found;
	root.traverse( ( o ) => {

		if ( ! found && o.isMesh && pattern.test( o.material.name ) ) found = o.material;

	} );
	return found;

}

function replaceMaterial( root, source, replacement ) {

	root.traverse( ( o ) => {

		if ( o.isMesh && o.material === source ) o.material = replacement;

	} );

}

function setupWheels( car, model ) {

	car.wheels = [];
	car.frontPivots = [];

	for ( const [ id, parts ] of Object.entries( WHEELS ) ) {

		const wheel = model.getObjectByName( parts.wheel );
		const caliper = model.getObjectByName( parts.caliper );
		if ( ! wheel || ! caliper ) throw new Error( `Audi wheel assembly not found: ${ id }` );

		const pivot = new THREE.Group();
		pivot.name = `wheel_${ id }`;
		pivot.position.copy( localBox( car, wheel ).getCenter( new THREE.Vector3() ) );
		const spinner = new THREE.Group();
		pivot.add( spinner );
		car.root.add( pivot );
		spinner.attach( wheel );
		pivot.attach( caliper );

		car.wheels.push( spinner );
		if ( id[ 0 ] === 'f' ) car.frontPivots.push( pivot );

	}

}

function setupSteering( car ) {

	car.steeringWheel = new THREE.Group();
	car.steeringWheel.position.copy( car.model.cockpitEye ).add( new THREE.Vector3( 0, - 0.22, - 0.15 ) );
	car.steeringBase = car.steeringWheel.quaternion.clone();
	car.chassis.add( car.steeringWheel );

}

function setupDoorAnimations( car, gltf, model ) {

	const open = gltf.animations.find( ( clip ) => clip.name === 'DOOR OPEN' );
	if ( ! open ) throw new Error( 'Audi door animation not found' );

	const doors = {
		left: [ 'door_animation1group1', 'door_animation1group8' ],
		right: [ 'door_animation1group6', 'door_animation1group7' ],
	};
	// `AUDI` has already been moved under the chassis, so the mixer must be
	// rooted there; using the outer GLTF scene leaves the tracks unbound.
	car.doorMixer = new THREE.AnimationMixer( car.chassis );
	car.doorActions = {};
	car.doorPivots = {};

	for ( const [ side, names ] of Object.entries( doors ) ) {

		const tracks = open.tracks.filter( ( track ) => names.some( ( name ) => track.name.startsWith( `${ name }.` ) ) );
		if ( tracks.length !== names.length ) throw new Error( `Audi ${ side } door tracks not found` );
		const clip = new THREE.AnimationClip( `audi-${ side }-doors`, open.duration, tracks );
		const action = car.doorMixer.clipAction( clip );
		action.setLoop( THREE.LoopOnce, 1 );
		action.clampWhenFinished = true;
		action.play();
		action.paused = true;
		car.doorActions[ side ] = action;
		car.doorPivots[ side ] = car.chassis.getObjectByName( names[ 0 ] );
		audi.updateDoor( car, side, 0 );

	}

}
