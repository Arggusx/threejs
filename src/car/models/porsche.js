import * as THREE from 'three';

// Porsche 992 GT3 R (MattDoesBlender, Sketchfab — CC BY-NC-SA 4.0).
// No arquivo original a frente aponta para +Z, a esquerda do carro é +X e o pneu toca
// o chão em y = 0.02. Toda a geometria já está no lugar (os nós não têm transformação),
// então os pivôs são calculados a partir das caixas das peças.

const GROUND_OFFSET = 0.02;
const WHEEL_IDS = { fl: 'LF', fr: 'RF', rl: 'LR', rr: 'RR' };

// Eixo da coluna de direção (espaço do carro, apontando para a frente) e centro do volante
const STEERING_CENTER = new THREE.Vector3( - 0.305, 0.742 - GROUND_OFFSET, - 0.213 );
const STEERING_AXIS = new THREE.Vector3( 0, - 0.347, - 0.938 ).normalize();

// Materiais do arquivo trocados pelos materiais configuráveis do carro (pelo nome)
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
	spoilers: false, // já vem com asa traseira
	interiorTint: 0.6, // o Alcantara não tem textura: as cores do painel ficam mais escuras
	defaults: { paint: '#f2f2f0' },

	build( car, gltf ) {

		// O arquivo vem do Sketchfab com uma escala de 0.01 nos nós de cima; o "RootNode"
		// já está em metros. Gira 180° para a frente do carro ficar em -Z.
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

		// Tudo que não é roda vai para o "chassi", que pode inclinar e mudar de altura
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

// Caixa de um objeto no espaço do carro (car.root)
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

			// No arquivo as peças sem textura vieram todas em cinza claro: viram plástico/borracha escuros
			o.material.color.set( 0x1c1c1c );
			o.material.roughness = 0.6;

		}

	} );

	// Rodas "borradas" (efeito de movimento do Sketchfab) ficam ocultas
	for ( const id of Object.values( WHEEL_IDS ) ) car.root.getObjectByName( `RIM_BLUR_${ id }` ).visible = false;

	// Luzes: cada grupo ganha um material próprio para acender de forma independente
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

	// Cada roda ganha um pivô para poder esterçar (Y) e, dentro dele, um grupo que gira (X)
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
		// Pinça de freio: esterça com a roda, mas não gira
		pivot.attach( car.root.getObjectByName( `SUSP_${ name }` ) );

		car.wheels.push( spinner );
		if ( id[ 0 ] === 'f' ) car.frontPivots.push( pivot );

	}

}

function setupSteeringWheel( car ) {

	// O eixo Y local do pivô fica alinhado com a coluna de direção, como na Ferrari
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

		// A dobradiça fica na frente da porta
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
