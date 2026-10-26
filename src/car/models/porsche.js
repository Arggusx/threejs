import * as THREE from 'three';

const GROUND_OFFSET = 0.02;
const WHEEL_IDS = { fl: 'LF', fr: 'RF', rl: 'LR', rr: 'RR' };

const STEERING_CENTER = new THREE.Vector3( - 0.305, 0.742 - GROUND_OFFSET, - 0.213 );
const STEERING_AXIS = new THREE.Vector3( 0, - 0.347, - 0.938 ).normalize();

const MATERIAL_SLOTS = [
	[ /Carpaint/, 'body' ],
	[ /^EXT_RIM(_\d+)?$/, 'rims' ],
	[ /^EXT_Windows/, 'glass' ],
	[ /CALIPER/, 'caliper' ],
	[ /Carbon|KEVLAR|CARBON_BAGE/, 'carbon' ],
	[ /SEAT_ALCANTARA/, 'leather' ],
	[ /Mechanics|EXALTS|METAL_PARTS|RADIATOR|TAMP_FUEL|WELDING/, 'details' ],
];

export const porsche = {

	id: 'porsche',
	name: 'Porsche 911',
	subtitle: 'GT3 R',
	url: './models/porsche/porsche_992_gt3_r.glb',

	wheelbase: 2.51,
	wheelRadius: 0.35,
	halfWidth: 1.03,
	halfLength: 2.38,
	shadowSize: [ 2.75, 5.5 ],
	headlight: { x: 0.72, y: 0.64, inset: 0.5 },
	cockpitEye: new THREE.Vector3( - 0.31, 1.0, 0.22 ),
	spoilers: false,
	interiorTint: 0.6,
	defaults: { paint: '#f2f2f0' },

	build( car, gltf ) {

		const model = gltf.scene.getObjectByName( 'RootNode' );
		model.removeFromParent();
		model.rotation.y = Math.PI;
		model.position.y = - GROUND_OFFSET;

		const root = new THREE.Group();
		root.add( model );
		car.root = root;
		car.object.add( root );
		root.updateMatrixWorld( true );

		applyMaterials( car );
		setupWheels( car );

		car.chassis = new THREE.Group();
		car.chassis.name = 'chassis';
		root.add( car.chassis );
		car.chassis.attach( model );
		setupSteeringWheel( car );
		root.updateMatrixWorld( true );

		car.bounds = localBox( car, root.getObjectByName( 'MAIN_BODY' ) );
		setupDoors( car );

	},

};

function localBox( car, object ) {

	const inv = car.root.matrixWorld.clone().invert();
	return new THREE.Box3().setFromObject( object ).applyMatrix4( inv );

}

function applyMaterials( car ) {

	const m = car.materials;
	m.leather = new THREE.MeshStandardMaterial( { color: 0x2b2b2b, roughness: 0.9 } );
	m.details.color.set( 0x4a4a4a );
	m.details.metalness = 0.9;
	m.details.roughness = 0.4;

	car.root.traverse( ( o ) => {

		if ( ! o.isMesh ) return;

		const slot = MATERIAL_SLOTS.find( ( [ pattern ] ) => pattern.test( o.material.name ) );

		if ( slot ) {

			o.material = m[ slot[ 1 ] ];

		} else if ( ! o.material.map ) {

			o.material.color.set( 0x1c1c1c );
			o.material.roughness = 0.6;

		}

	} );

	for ( const id of Object.values( WHEEL_IDS ) ) car.root.getObjectByName( `RIM_BLUR_${ id }` ).visible = false;

	const light = ( names ) => {

		const material = car.root.getObjectByName( names[ 0 ] ).children[ 0 ].material.clone();
		material.emissiveMap = material.map;
		material.emissiveIntensity = 0;
		for ( const name of names ) car.root.getObjectByName( name ).traverse( ( o ) => o.isMesh && ( o.material = material ) );
		return material;

	};

	m.headlights = light( [ 'porsche_992_gt3_r_exterior_SUB7', 'L0', 'L1' ] );
	m.taillights = light( [ 'porsche_992_gt3_r_exterior_SUB8', 'ST_REAR', 'B0' ] );
	m.leds = light( [ 'ST_FRONT_LF', 'ST_FRONT_RF' ] );
	m.rearLeds = light( [ 'ST_REAR_LR', 'ST_REAR_RR' ] );

}

function setupWheels( car ) {

	car.wheels = [];
	car.frontPivots = [];

	for ( const [ id, name ] of Object.entries( WHEEL_IDS ) ) {

		const center = localBox( car, car.root.getObjectByName( `GEO_TIRE_${ name }` ) ).getCenter( new THREE.Vector3() );

		const pivot = new THREE.Group();
		pivot.name = `wheel_${ id }`;
		pivot.position.copy( center );
		const spinner = new THREE.Group();
		pivot.add( spinner );
		car.root.add( pivot );
		pivot.updateMatrixWorld( true );

		spinner.attach( car.root.getObjectByName( `WHEEL_${ name }` ) );
		spinner.attach( car.root.getObjectByName( `DISC_${ name }` ) );
		pivot.attach( car.root.getObjectByName( `SUSP_${ name }` ) );

		car.wheels.push( spinner );
		if ( id[ 0 ] === 'f' ) car.frontPivots.push( pivot );

	}

}

function setupSteeringWheel( car ) {

	const pivot = new THREE.Group();
	pivot.name = 'steering_wheel';
	pivot.position.copy( STEERING_CENTER );
	pivot.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), STEERING_AXIS );
	car.chassis.add( pivot );
	pivot.updateMatrixWorld( true );
	pivot.attach( car.root.getObjectByName( 'STEER_HR' ) );

	car.steeringWheel = pivot;
	car.steeringBase = pivot.quaternion.clone();

}

function setupDoors( car ) {

	car.doorPivots = {};

	for ( const [ side, name ] of [ [ 'left', 'L' ], [ 'right', 'R' ] ] ) {

		const hinge = localBox( car, car.root.getObjectByName( `DOBRADICA_DOOR_${ name }` ) ).getCenter( new THREE.Vector3() );
		hinge.y = 0;

		const pivot = new THREE.Group();
		pivot.name = `door_${ side }`;
		pivot.position.copy( hinge );
		car.chassis.add( pivot );
		pivot.updateMatrixWorld( true );
		pivot.attach( car.root.getObjectByName( `DOOR_${ name }` ) );
		car.doorPivots[ side ] = pivot;

	}

}
