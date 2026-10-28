import * as THREE from 'three';

// Kart de doce da Vanellope. O modelo é pequeno (~2 de comprimento) e olha para +Z; aqui ele é
// escalado 1,5x, virado para -Z e centralizado. Não tem portas (é aberto) nem volante separado.
const SCALE = 1.5;
const SPOILER_UP = - 0.5; // inclinação do aerofólio em alta velocidade (a borda de trás sobe)
const SPOILER_SPEED = 9; // m/s a partir dos quais ele levanta
const BOOST_ACCEL = 16;
const BOOST_TOP = 34; // m/s (~120 km/h)
const SPARKS = 90;
const SPARK_COLORS = [ 0x00fff0, 0xff2bd6, 0xfff27a, 0xffffff ].map( ( c ) => new THREE.Color( c ) );
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

		setupSpoiler( car, model );
		car.kart = { jelly: 0, jellyVelocity: 0, prevSpeed: 0, boost: 0, sparks: null, body: findBodyMaterial( model ) };

	},

	// Peças que se mexem sozinhas (precisam ficar fora da junção de malhas).
	movingParts: ( car ) => [ car.spoilerPivot ],

	// Animações próprias do kart, chamadas a cada quadro depois da física:
	// - aerofólio que levanta em alta velocidade;
	// - "glitch boost" (Shift acelerando): turbo com faíscas de doce e o kart piscando;
	// - efeito gelatina: a carroceria estica e achata nas arrancadas, freadas e aterrissagens.
	animate( car, dt, input ) {

		const k = car.kart;
		if ( ! dt ) return;

		const up = Math.abs( car.speed ) > SPOILER_SPEED ? SPOILER_UP : 0;
		car.spoilerPivot.rotation.x += ( up - car.spoilerPivot.rotation.x ) * Math.min( 1, dt * 4 );

		const boosting = !! input?.run && input.throttle > 0 && ! car.autopilot && car.speed > - 0.5;
		if ( boosting && car.speed < BOOST_TOP ) car.speed = Math.min( BOOST_TOP, car.speed + BOOST_ACCEL * dt );
		k.boost += ( ( boosting ? 1 : 0 ) - k.boost ) * Math.min( 1, dt * 8 );
		updateSparks( car, dt, boosting );

		// Glitch visual do boost: a carroceria treme de lado e pisca em cores neon.
		const shake = k.boost * ( Math.random() - 0.5 ) * 0.12;
		car.chassis.position.x = shake;
		if ( k.body ) {

			const flash = k.boost > 0.05 && Math.random() < 0.35;
			k.body.emissive.copy( SPARK_COLORS[ Math.floor( Math.random() * 3 ) ] );
			k.body.emissiveIntensity = flash ? 0.6 * k.boost : 0;

		}

		// Mola: aceleração para frente/trás (e quedas) puxam a carroceria; ela volta balançando.
		const accel = ( car.speed - k.prevSpeed ) / dt;
		k.prevSpeed = car.speed;
		const push = THREE.MathUtils.clamp( - accel * 0.004, - 0.08, 0.08 ) + THREE.MathUtils.clamp( - car.velocityY * 0.015, - 0.1, 0.1 );
		k.jellyVelocity += ( - 160 * k.jelly - 6 * k.jellyVelocity + push * 160 ) * dt;
		k.jelly = THREE.MathUtils.clamp( k.jelly + k.jellyVelocity * dt, - 0.14, 0.14 );
		car.chassis.scale.set( 1 - k.jelly * 0.5, 1 + k.jelly, 1 - k.jelly * 0.5 );

	},

};

function setupSpoiler( car, model ) {

	let spoiler = null;
	model.traverse( ( o ) => ! spoiler && o.isMesh && /^spoiler/.test( o.name ) && ( spoiler = o ) );

	// Dobradiça na borda da frente, embaixo, do aerofólio (ele fica na traseira, +Z).
	const box = localBox( car, spoiler );
	const pivot = new THREE.Group();
	pivot.name = 'spoiler_pivot';
	pivot.position.set( 0, box.min.y, box.min.z );
	car.chassis.add( pivot );
	pivot.updateMatrixWorld( true );
	pivot.attach( spoiler );
	car.spoilerPivot = pivot;

}

function findBodyMaterial( model ) {

	let body = null;
	model.traverse( ( o ) => ! body && o.isMesh && /^BodyModel/.test( o.name ) && ( body = o.material ) );
	return body?.emissive ? body : null;

}

// Faíscas do turbo: pontos no mundo que saem da traseira, sobem um pouco e somem.
function updateSparks( car, dt, emitting ) {

	const k = car.kart;
	const scene = car.object.parent;
	if ( ! k.sparks && emitting && scene ) {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( SPARKS * 3 ).fill( - 1e4 ), 3 ) );
		geometry.setAttribute( 'color', new THREE.BufferAttribute( new Float32Array( SPARKS * 3 ), 3 ) );
		const points = new THREE.Points( geometry, new THREE.PointsMaterial( {
			size: 0.35, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
		} ) );
		points.frustumCulled = false;
		scene.add( points );
		k.sparks = { points, life: new Float32Array( SPARKS ), velocity: new Float32Array( SPARKS * 3 ), next: 0, alive: 0 };

	}

	const s = k.sparks;
	if ( ! s ) return;

	const position = s.points.geometry.attributes.position;
	const color = s.points.geometry.attributes.color;
	const tmp = new THREE.Vector3();

	if ( emitting ) {

		for ( let n = 0; n < 3; n ++ ) {

			const i = s.next;
			s.next = ( s.next + 1 ) % SPARKS;
			car.object.localToWorld( tmp.set( ( Math.random() - 0.5 ) * 1.2, 0.35 + Math.random() * 0.4, car.model.halfLength ) );
			position.setXYZ( i, tmp.x, tmp.y, tmp.z );
			const back = car.forward( new THREE.Vector3() ).multiplyScalar( - 4 );
			s.velocity.set( [ back.x + ( Math.random() - 0.5 ) * 3, 1.5 + Math.random() * 2, back.z + ( Math.random() - 0.5 ) * 3 ], i * 3 );
			const c = SPARK_COLORS[ Math.floor( Math.random() * SPARK_COLORS.length ) ];
			color.setXYZ( i, c.r, c.g, c.b );
			s.life[ i ] = 0.5 + Math.random() * 0.3;

		}

	}

	let alive = 0;
	for ( let i = 0; i < SPARKS; i ++ ) {

		if ( s.life[ i ] <= 0 ) continue;
		s.life[ i ] -= dt;
		if ( s.life[ i ] <= 0 ) {

			position.setXYZ( i, 0, - 1e4, 0 );
			continue;

		}

		alive ++;
		s.velocity[ i * 3 + 1 ] -= 6 * dt;
		position.setXYZ( i, position.getX( i ) + s.velocity[ i * 3 ] * dt, position.getY( i ) + s.velocity[ i * 3 + 1 ] * dt, position.getZ( i ) + s.velocity[ i * 3 + 2 ] * dt );
		const fade = Math.min( 1, s.life[ i ] * 2.5 );
		color.setXYZ( i, color.getX( i ) * ( 0.97 + 0.03 * fade ), color.getY( i ) * ( 0.97 + 0.03 * fade ), color.getZ( i ) * ( 0.97 + 0.03 * fade ) );

	}

	position.needsUpdate = color.needsUpdate = true;
	s.points.visible = alive > 0;

}

function localBox( car, object ) {

	return new THREE.Box3().setFromObject( object ).applyMatrix4( car.root.matrixWorld.clone().invert() );

}
