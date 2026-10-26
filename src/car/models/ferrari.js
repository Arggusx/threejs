import * as THREE from 'three';

// Ferrari 458 Italia (exemplo webgl_materials_car do three.js).
// Frente do carro apontando para -Z, unidades em metros.

// Região (no espaço do carro) que define cada porta. Os triângulos cujo centro
// cai dentro dela são recortados da carroceria e presos a uma dobradiça.
const DOOR_REGION = { xMin: 0.6, zMin: - 0.72, zMax: 0.6, yMin: 0.3, yMax: 1.0 };

export const ferrari = {

	id: 'ferrari',
	name: 'Ferrari 458',
	subtitle: 'Italia',
	url: './models/ferrari/ferrari.glb',

	wheelbase: 2.65,
	wheelRadius: 0.36,
	halfWidth: 0.98,
	halfLength: 2.25,
	shadowSize: [ 0.655 * 4, 1.3 * 4 ],
	headlight: { x: 0.62, y: 0.62, inset: 0.35 },
	cockpitEye: new THREE.Vector3( - 0.36, 1.13, 0.32 ),
	spoilers: true,
	interiorTint: 1,
	defaults: { paint: '#d40000' },

	build( car, gltf ) {

		const root = gltf.scene.children[ 0 ];
		car.root = root;
		car.object.add( root );

		// Tudo que não é roda vai para o "chassi", que pode inclinar e mudar de altura
		car.chassis = new THREE.Group();
		car.chassis.name = 'chassis';
		root.add( car.chassis );
		car.chassis.attach( root.getObjectByName( 'main' ) );
		car.chassis.attach( root.getObjectByName( 'steering_wheel' ) );

		applyMaterials( car );
		setupWheels( car );
		root.updateMatrixWorld( true );

		car.bodyMesh = root.getObjectByName( 'body' );
		car.bounds = new THREE.Box3().setFromObject( car.bodyMesh );
		setupDoors( car );

	},

};

function applyMaterials( car ) {

	const get = ( name ) => car.root.getObjectByName( name );
	const m = car.materials;

	get( 'body' ).material = m.body;
	get( 'trim' ).material = m.details;
	get( 'glass' ).material = m.glass;
	for ( const w of [ 'fl', 'fr', 'rl', 'rr' ] ) get( `rim_${ w }` ).material = m.rims;

	// Materiais originais que vamos modificar: cloná-los evita efeitos colaterais
	const leather = get( 'leather' );
	leather.material = leather.material.clone();
	m.leather = leather.material;
	get( 'steering_leather' ).material = m.leather;

	const lights = get( 'lights' );
	lights.material = lights.material.clone();
	m.headlights = lights.material;

	const tail = get( 'lights_red' );
	tail.material = tail.material.clone();
	m.taillights = tail.material;

	const leds = get( 'leds' );
	leds.material = leds.material.clone();
	m.leds = leds.material;

}

function setupWheels( car ) {

	// Cada roda ganha um pivô para poder esterçar (Y) independentemente do giro (X)
	car.wheels = [];
	car.frontPivots = [];

	for ( const id of [ 'fl', 'fr', 'rl', 'rr' ] ) {

		const wheel = car.root.getObjectByName( `wheel_${ id }` );
		const pivot = new THREE.Group();
		pivot.position.copy( wheel.position );
		car.root.add( pivot );
		pivot.add( wheel );
		wheel.position.set( 0, 0, 0 );

		car.wheels.push( wheel );
		if ( id[ 0 ] === 'f' ) car.frontPivots.push( pivot );

		// Pinça de freio: um arco preso ao pivô (esterça com a roda, mas não gira)
		const caliper = new THREE.Mesh( new THREE.TorusGeometry( 0.19, 0.038, 8, 16, 1 ), car.materials.caliper );
		caliper.rotation.set( 0, Math.PI / 2, 0 );
		caliper.rotateZ( THREE.MathUtils.degToRad( 121 ) );
		caliper.scale.z = 0.9;
		caliper.position.x = ( id[ 1 ] === 'l' ? - 1 : 1 ) * 0.045;
		pivot.add( caliper );

	}

	car.steeringWheel = car.root.getObjectByName( 'steering_wheel' );
	car.steeringBase = car.steeringWheel.quaternion.clone();

}

function setupDoors( car ) {

	const main = car.root.getObjectByName( 'main' );
	const rootInv = car.root.matrixWorld.clone().invert();
	const r = DOOR_REGION;

	car.doorPivots = {};

	for ( const [ side, sign ] of [ [ 'left', - 1 ], [ 'right', 1 ] ] ) {

		const hinge = new THREE.Vector3( sign * 0.92, 0, r.zMin );
		const pivot = new THREE.Group();
		pivot.name = `door_${ side }`;
		pivot.position.copy( hinge );
		car.chassis.add( pivot );
		car.doorPivots[ side ] = pivot;

		const inDoor = ( p ) => sign * p.x > r.xMin && p.z > r.zMin && p.z < r.zMax && p.y > r.yMin && p.y < r.yMax;

		for ( const mesh of [ ...main.children ] ) {

			if ( ! mesh.isMesh ) continue;

			const matrix = new THREE.Matrix4().multiplyMatrices( rootInv, mesh.matrixWorld );
			const doorGeometry = splitGeometry( mesh, matrix, inDoor );
			if ( ! doorGeometry ) continue;

			doorGeometry.translate( - hinge.x, - hinge.y, - hinge.z );
			const part = new THREE.Mesh( doorGeometry, mesh.material );
			part.name = `${ mesh.name }_door_${ side }`;
			pivot.add( part );

		}

	}

}

// Separa os triângulos de `mesh` que satisfazem `test` (no espaço dado por `matrix`).
// A malha original fica com o restante; retorna os triângulos removidos já
// transformados para esse espaço, ou null se nenhum triângulo foi selecionado.
function splitGeometry( mesh, matrix, test ) {

	const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
	const pos = source.attributes.position;
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
	const keep = [], take = [];

	for ( let t = 0; t < pos.count / 3; t ++ ) {

		a.fromBufferAttribute( pos, t * 3 ).applyMatrix4( matrix );
		b.fromBufferAttribute( pos, t * 3 + 1 ).applyMatrix4( matrix );
		c.fromBufferAttribute( pos, t * 3 + 2 ).applyMatrix4( matrix );
		a.add( b ).add( c ).divideScalar( 3 );
		( test( a ) ? take : keep ).push( t );

	}

	if ( take.length === 0 ) return null;

	mesh.geometry = pickTriangles( source, keep );
	return pickTriangles( source, take ).applyMatrix4( matrix );

}

function pickTriangles( geometry, triangles ) {

	const out = new THREE.BufferGeometry();

	for ( const [ name, attr ] of Object.entries( geometry.attributes ) ) {

		const size = attr.itemSize;
		const stride = 3 * size;
		const array = new attr.array.constructor( triangles.length * stride );

		triangles.forEach( ( t, i ) => array.set( attr.array.subarray( t * stride, t * stride + stride ), i * stride ) );
		out.setAttribute( name, new THREE.BufferAttribute( array, size, attr.normalized ) );

	}

	return out;

}
