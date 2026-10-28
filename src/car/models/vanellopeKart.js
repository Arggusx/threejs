import * as THREE from 'three';

// Kart de doce da Vanellope. O modelo é pequeno (~2 de comprimento) e olha para +Z; aqui ele é
// escalado 1,5x, virado para -Z e centralizado. Não tem portas (é aberto) nem volante separado.
const SCALE = 1.5;
const WHEELS = {
	fl: /^wheelFrontLeft/,
	fr: /^wheelFrontRight/,
	rl: /^wheelBackLeft/,
	rr: /^wheelBackRight/,
};

export const vanellopeKart = {

	id: 'vanellope-kart',
	name: 'Candy Kart',
	subtitle: 'da Vanellope',
	url: './models/vanellope/kart.glb',

	wheelbase: 1.56,
	wheelRadius: 0.36,
	halfWidth: 0.95,
	halfLength: 1.55,
	shadowSize: [ 2.1, 3.4 ],
	headlight: { x: 0.5, y: 0.4, inset: 0.3 },
	// Assento: almofada em z ~ -0,1 e encosto em z ~ +0,15 (já no espaço do jogo).
	cockpitEye: new THREE.Vector3( 0, 0.95, 0 ),
	spoilers: false,
	interiorTint: 1,
	// Pintura, rodas, vidros e couro não se aplicam: o kart tem textura própria.
	customizable: false,
	doors: false,
	defaults: {},

	build( car, gltf ) {

		const model = gltf.scene;
		model.scale.setScalar( SCALE );
		model.rotation.y = Math.PI;

		const root = new THREE.Group();
		root.add( model );
		car.root = root;
		car.object.add( root );
		root.updateMatrixWorld( true );

		const box = localBox( car, model );
		const center = box.getCenter( new THREE.Vector3() );
		model.position.set( - center.x, - box.min.y, - center.z );
		root.updateMatrixWorld( true );

		const m = car.materials;
		m.leather = new THREE.MeshStandardMaterial( { color: 0x5a2e1c } );
		m.headlights = new THREE.MeshStandardMaterial();
		m.taillights = new THREE.MeshStandardMaterial();
		m.leds = new THREE.MeshStandardMaterial();

		car.wheels = [];
		car.frontPivots = [];
		for ( const [ id, pattern ] of Object.entries( WHEELS ) ) {

			let wheel = null;
			model.traverse( ( o ) => ! wheel && o.isMesh && pattern.test( o.name ) && ( wheel = o ) );
			if ( ! wheel ) throw new Error( `Roda do kart não encontrada: ${ id }` );

			const pivot = new THREE.Group();
			pivot.name = `wheel_${ id }`;
			pivot.position.copy( localBox( car, wheel ).getCenter( new THREE.Vector3() ) );
			const spinner = new THREE.Group();
			pivot.add( spinner );
			root.add( pivot );
			pivot.updateMatrixWorld( true );
			spinner.attach( wheel );

			car.wheels.push( spinner );
			if ( id[ 0 ] === 'f' ) car.frontPivots.push( pivot );

		}

		car.chassis = new THREE.Group();
		car.chassis.name = 'chassis';
		root.add( car.chassis );
		car.chassis.attach( model );
		root.updateMatrixWorld( true );
		car.bounds = localBox( car, car.chassis );

		// Volante "invisível" na frente do assento, só para as mãos do piloto terem onde segurar.
		car.steeringWheel = new THREE.Group();
		car.steeringWheel.position.set( 0, 0.72, - 0.5 );
		car.steeringWheel.rotation.x = - 0.6;
		car.steeringBase = car.steeringWheel.quaternion.clone();
		car.chassis.add( car.steeringWheel );

		car.doorPivots = { left: new THREE.Group(), right: new THREE.Group() };

	},

};

function localBox( car, object ) {

	return new THREE.Box3().setFromObject( object ).applyMatrix4( car.root.matrixWorld.clone().invert() );

}
