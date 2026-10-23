import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Car } from './car.js';
import { Garage } from './garage.js';
import { updateTweens, wait } from './tween.js';

// ---------------------------------------------------------------- renderer / cena

const container = document.getElementById( 'container' );

const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x2a2e35 );
scene.fog = new THREE.Fog( 0x2a2e35, 40, 140 );

const environment = new HDRLoader().load( './textures/venice_sunset_1k.hdr' );
environment.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = environment;
scene.environmentIntensity = 0.9;

const camera = new THREE.PerspectiveCamera( 40, window.innerWidth / window.innerHeight, 0.05, 400 );
camera.position.set( 4.25, 1.4, - 4.5 );

const controls = new OrbitControls( camera, renderer.domElement );
controls.enableDamping = true;
controls.maxDistance = 14;
controls.minDistance = 2.5;
controls.maxPolarAngle = THREE.MathUtils.degToRad( 88 );
controls.target.set( 0, 0.5, 0 );

// Sol com sombras (acompanha o carro para manter a resolução da sombra)
const sun = new THREE.DirectionalLight( 0xfff0dd, 1.6 );
sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 );
sun.shadow.camera.left = sun.shadow.camera.bottom = - 16;
sun.shadow.camera.right = sun.shadow.camera.top = 16;
sun.shadow.camera.far = 80;
sun.shadow.bias = - 0.0004;
scene.add( sun, sun.target );

// Chão
const ground = new THREE.Mesh(
	new THREE.PlaneGeometry( 600, 600 ),
	new THREE.MeshStandardMaterial( { color: 0x3b3e44, roughness: 0.95 } )
);
ground.rotation.x = - Math.PI / 2;
ground.receiveShadow = true;
scene.add( ground );

const grid = new THREE.GridHelper( 600, 300, 0xffffff, 0xffffff );
grid.material.opacity = 0.07;
grid.material.transparent = true;
grid.material.depthWrite = false;
grid.position.y = 0.003;
scene.add( grid );

// Garagem + acesso de concreto
const garage = new Garage();
scene.add( garage.object );

const driveway = new THREE.Mesh(
	new THREE.PlaneGeometry( 5, 12 ),
	new THREE.MeshStandardMaterial( { color: 0x8d8e90, roughness: 0.85 } )
);
driveway.rotation.x = - Math.PI / 2;
driveway.position.set( garage.entrance.x, 0.004, garage.entrance.z + 6 );
driveway.receiveShadow = true;
scene.add( driveway );

addCones();

// Limites do mundo
const worldLimit = 280;
const worldBounds = [
	new THREE.Box2( new THREE.Vector2( - 400, - 400 ), new THREE.Vector2( 400, - worldLimit ) ),
	new THREE.Box2( new THREE.Vector2( - 400, worldLimit ), new THREE.Vector2( 400, 400 ) ),
	new THREE.Box2( new THREE.Vector2( - 400, - 400 ), new THREE.Vector2( - worldLimit, 400 ) ),
	new THREE.Box2( new THREE.Vector2( worldLimit, - 400 ), new THREE.Vector2( 400, 400 ) ),
];

// ---------------------------------------------------------------- carro

const car = new Car();
scene.add( car.object );

const loadingBar = document.getElementById( 'loading-bar' );

car.load( ( p ) => ( loadingBar.style.width = `${ p * 100 }%` ) ).then( () => {

	document.getElementById( 'loading' ).classList.add( 'done' );
	renderer.setAnimationLoop( loop );

} ).catch( ( err ) => {

	console.error( err );
	document.querySelector( '.loading-title' ).textContent = 'Erro ao carregar o modelo: ' + err.message;

} );

// ---------------------------------------------------------------- entrada

const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const IDLE_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: false };

window.addEventListener( 'keydown', ( e ) => {

	if ( e.target.tagName === 'INPUT' ) return;
	if ( [ 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space' ].includes( e.code ) ) e.preventDefault();
	if ( e.repeat ) return;

	keys.add( e.code );

	switch ( e.code ) {

		case 'KeyL': actions.lights(); break;
		case 'KeyH': actions.hazards(); break;
		case 'KeyC': setCameraMode( CAMERA_MODES[ ( CAMERA_MODES.indexOf( cameraMode ) + 1 ) % CAMERA_MODES.length ] ); break;
		case 'KeyG': actions.garage(); break;
		case 'KeyQ': actions[ 'door-left' ](); break;
		case 'KeyE': actions[ 'door-right' ](); break;

	}

} );

window.addEventListener( 'keyup', ( e ) => keys.delete( e.code ) );
window.addEventListener( 'blur', () => keys.clear() );

function readInput() {

	const has = ( ...codes ) => codes.some( ( c ) => keys.has( c ) );
	input.throttle = has( 'KeyW', 'ArrowUp' ) ? 1 : 0;
	input.brake = has( 'KeyS', 'ArrowDown' ) ? 1 : 0;
	input.steer = ( has( 'KeyA', 'ArrowLeft' ) ? 1 : 0 ) - ( has( 'KeyD', 'ArrowRight' ) ? 1 : 0 );
	input.handbrake = has( 'Space' );
	return input;

}

// ---------------------------------------------------------------- câmera

const CAMERA_MODES = [ 'orbit', 'chase', 'cockpit' ];
const COCKPIT_EYE = new THREE.Vector3( - 0.36, 1.13, 0.32 ); // olhos do motorista (espaço do chassi)
let cameraMode = 'orbit';
const lastCarPosition = new THREE.Vector3();
const tmp = new THREE.Vector3();

function setCameraMode( mode ) {

	cameraMode = mode;
	controls.enabled = mode === 'orbit';
	camera.fov = mode === 'cockpit' ? 62 : 40;
	camera.updateProjectionMatrix();

	if ( mode === 'orbit' ) {

		controls.target.copy( car.position ).setY( 0.5 );
		camera.position.copy( car.object.localToWorld( tmp.set( 4.5, 1.6, - 4.5 ) ) );

	}

	setActive( 'camera', mode );

}

function updateCamera( dt ) {

	const delta = tmp.subVectors( car.position, lastCarPosition );
	lastCarPosition.copy( car.position );

	if ( cameraMode === 'orbit' ) {

		// A câmera livre "anda junto" com o carro
		camera.position.add( delta );
		controls.target.add( delta );
		controls.update();

	} else if ( cameraMode === 'chase' ) {

		const inside = garage.contains( car.position );
		const desired = car.object.localToWorld( new THREE.Vector3( 0, inside ? 1.9 : 1.7, inside ? 3.8 : 6.2 ) );
		camera.position.lerp( desired, 1 - Math.exp( - dt * 5 ) );
		camera.lookAt( car.object.localToWorld( new THREE.Vector3( 0, 0.7, - 2 ) ) );

	} else {

		camera.position.copy( car.chassis.localToWorld( COCKPIT_EYE.clone() ) );
		camera.lookAt( car.chassis.localToWorld( new THREE.Vector3( - 0.36, 0.95, - 5 ) ) );

	}

}

// ---------------------------------------------------------------- ações

let busy = false;

const actions = {

	'door-left': () => toggleDoor( 'left' ),
	'door-right': () => toggleDoor( 'right' ),

	lights() {

		car.setHeadlights( ! car.headlightsOn );
		setActiveAction( 'lights', car.headlightsOn );

	},

	hazards() {

		car.setHazards( ! car.hazardsOn );
		setActiveAction( 'hazards', car.hazardsOn );

	},

	garage() {

		if ( busy ) return;
		if ( garage.contains( car.position ) ) leaveGarage();
		else goToGarage();

	},

};

function toggleDoor( side ) {

	if ( busy ) return;
	if ( Math.abs( car.speed ) > 0.5 ) return toast( 'Pare o carro para abrir as portas' );
	car.toggleDoor( side );
	setActiveAction( `door-${ side }`, car.isDoorOpen( side ) );

}

async function runSequence( label, fn ) {

	busy = true;
	setBusyUI( true, label );

	try {

		await fn();

	} finally {

		busy = false;
		setBusyUI( false );

	}

}

function goToGarage() {

	return runSequence( 'Indo para a garagem…', async () => {

		await stopCar();
		await closeCarDoors();
		garage.setLight( true );
		await garage.setDoor( true );

		// Se o carro está de frente para uma parede da garagem, primeiro dá ré para ganhar espaço
		const ahead = car.position.clone().addScaledVector( car.forward(), 3 );
		const facingDoor = Math.abs( car.position.x - garage.entrance.x ) < 2 && car.forward().z < - 0.7 && car.position.z > garage.entrance.z;
		if ( garage.isNear( ahead, 1.5 ) && ! facingDoor ) {

			await car.followPath( new THREE.LineCurve3( car.position.clone(), car.position.clone().addScaledVector( car.forward(), - 4 ) ), { maxSpeed: 2, reverse: true } );

		}

		const route = routeToGarage();
		await car.followPath( route.path, { maxSpeed: 6, reverse: route.reverse } );

		await wait( 0.3 );
		await garage.setDoor( false );
		toast( 'Carro estacionado na garagem' );

	} );

}

function leaveGarage() {

	return runSequence( 'Saindo da garagem…', async () => {

		await closeCarDoors();
		await garage.setDoor( true );

		// Sai de frente se estiver estacionado de frente para o portão; senão, de ré
		const forward = car.forward();
		const reverse = forward.z < 0;
		const travel = reverse ? forward.negate() : forward;
		const e = garage.entrance;
		const exit = new THREE.Vector3( e.x + 3.5, 0, e.z + 8.5 );
		const exitDir = new THREE.Vector3( 0.45, 0, 1 ).normalize();

		await car.followPath( bezier( car.position.clone(), travel, exit, exitDir, 3, 3 ), { maxSpeed: 3, reverse } );

		// Só apaga a luz se ninguém reabriu o portão enquanto ele fechava
		garage.setDoor( false ).then( ( finished ) => finished && garage.setLight( false ) );

	} );

}

// Curva de Bézier cúbica que sai de `p0` na direção `t0` e chega em `p1` na direção `t1`.
// As tangentes nas pontas são exatamente essas direções, então o carro nunca "gira no lugar".
function bezier( p0, t0, p1, t1, d0, d1 ) {

	return new THREE.CubicBezierCurve3(
		p0,
		p0.clone().addScaledVector( t0, d0 ),
		p1.clone().addScaledVector( t1, - d1 ),
		p1
	);

}

// Adiciona um trecho de (from, fromDir) até (to, toDir). Se o alvo estiver atrás do carro,
// faz antes um retorno em "U" — sem isso a Bézier pode degenerar numa linha que vai e volta,
// e o carro giraria 180° de uma vez.
function addLeg( path, from, fromDir, to, toDir, maxLead = 10 ) {

	const span = ( a, b ) => THREE.MathUtils.clamp( a.distanceTo( b ) * 0.4, 1, 10 );
	const toTarget = to.clone().sub( from ).normalize();

	if ( fromDir.dot( toTarget ) < 0 ) {

		const side = new THREE.Vector3( - fromDir.z, 0, fromDir.x );
		if ( side.dot( toTarget ) < 0 ) side.negate();

		const back = fromDir.clone().negate();
		const turn = from.clone().addScaledVector( fromDir, 3 ).addScaledVector( side, 9 );
		path.add( bezier( from, fromDir, turn, back, 6, 6 ) );
		from = turn;
		fromDir = back;

	}

	path.add( bezier( from, fromDir, to, toDir, Math.min( span( from, to ), maxLead ), span( from, to ) ) );

}

// Rota da posição atual até a vaga. Retorna { path, reverse }.
function routeToGarage() {

	const p = car.position.clone();
	const h = car.forward();
	const e = garage.entrance;
	const park = garage.parkSpot.clone();
	const inward = new THREE.Vector3( 0, 0, - 1 ); // sentido de quem entra na garagem
	const staging = new THREE.Vector3( e.x, 0, e.z + 9 ); // ponto alinhado com o portão
	const span = ( a, b ) => THREE.MathUtils.clamp( a.distanceTo( b ) * 0.4, 1, 10 );

	// Já no corredor em frente ao portão e alinhado: entra direto (de frente ou de ré)
	const inCorridor = Math.abs( p.x - e.x ) < 2 && p.z > e.z - 0.5 && p.z < staging.z + 1;

	if ( inCorridor && h.z < - 0.7 ) {

		return { path: bezier( p, h, park, inward, span( p, park ), span( p, park ) ), reverse: false };

	}

	if ( inCorridor && h.z > 0.7 ) {

		return { path: bezier( p, h.clone().negate(), park, inward, span( p, park ), span( p, park ) ), reverse: true };

	}

	const path = new THREE.CurvePath();

	if ( p.z < e.z + 1 ) {

		// Atrás ou ao lado da garagem: contorna pela lateral até a frente
		const side = p.x >= e.x ? 1 : - 1;
		const around = new THREE.Vector3( e.x + side * 10, 0, e.z + 2 );
		const north = new THREE.Vector3( 0, 0, 1 );

		if ( p.z < garage.object.position.z ) {

			// Atrás da garagem: primeiro anda de lado até sair da "sombra" dela,
			// com pouca entrada na direção atual (que pode estar apontando para a parede)
			const sideways = new THREE.Vector3( side, 0, 0 );
			const corner = new THREE.Vector3( e.x + side * Math.max( 10, Math.abs( p.x - e.x ) + 4 ), 0, p.z );
			addLeg( path, p, h, corner, sideways, 3 );
			path.add( bezier( corner, sideways, around, north, 6, 6 ) );

		} else {

			addLeg( path, p, h, around, north );

		}
		path.add( bezier( around, north, staging, inward, 6, 6 ) );

	} else {

		addLeg( path, p, h, staging, inward );

	}

	path.add( new THREE.LineCurve3( staging, park ) );
	return { path, reverse: false };

}

async function stopCar() {

	while ( Math.abs( car.speed ) > 0.05 ) {

		car.speed *= 0.85;
		await wait( 0.03 );

	}

	car.speed = 0;

}

async function closeCarDoors() {

	if ( car.doors.left > 0 || car.doors.right > 0 ) {

		await car.closeDoors();
		setActiveAction( 'door-left', false );
		setActiveAction( 'door-right', false );

	}

}

// ---------------------------------------------------------------- UI

const optionHandlers = {
	camera: setCameraMode,
	paint: ( v ) => {

		car.setPaint( v );
		document.getElementById( 'paint-custom' ).value = v;

	},
	finish: ( v ) => car.setPaintFinish( v ),
	rims: ( v ) => car.setRims( v ),
	calipers: ( v ) => car.setCalipers( v ),
	spoiler: ( v ) => car.setSpoiler( v ),
	glass: ( v ) => car.setGlass( v ),
	interior: ( v ) => car.setInterior( v ),
	suspension: ( v ) => car.setSuspension( v ),
};

document.querySelectorAll( '[data-option]' ).forEach( ( group ) => {

	group.addEventListener( 'click', ( e ) => {

		const button = e.target.closest( 'button[data-value]' );
		if ( ! button ) return;
		setActive( group.dataset.option, button.dataset.value );
		optionHandlers[ group.dataset.option ]( button.dataset.value );
		button.blur();

	} );

} );

document.getElementById( 'paint-custom' ).addEventListener( 'input', ( e ) => {

	car.setPaint( e.target.value );
	setActive( 'paint', null );

} );

document.querySelectorAll( '[data-action]' ).forEach( ( button ) => {

	button.addEventListener( 'click', () => {

		actions[ button.dataset.action ]();
		button.blur();

	} );

} );

document.getElementById( 'panel-toggle' ).addEventListener( 'click', ( e ) => {

	const panel = document.getElementById( 'panel' );
	panel.classList.toggle( 'collapsed' );
	e.currentTarget.textContent = panel.classList.contains( 'collapsed' ) ? '+' : '—';

} );

function setActive( option, value ) {

	document.querySelectorAll( `[data-option="${ option }"] button` ).forEach( ( b ) => b.classList.toggle( 'active', b.dataset.value === value ) );

}

function setActiveAction( action, on ) {

	document.querySelector( `[data-action="${ action }"]` ).classList.toggle( 'active', on );

}

function setBusyUI( on, label = '' ) {

	document.querySelectorAll( '[data-action^="door"], [data-action="garage"]' ).forEach( ( b ) => ( b.disabled = on ) );
	document.getElementById( 'status' ).textContent = label;

}

function updateGarageButton() {

	const button = document.querySelector( '[data-action="garage"]' );
	const label = garage.contains( car.position ) ? 'Sair da garagem' : 'Ir para a garagem';
	if ( button.firstChild.textContent.trim() !== label ) button.firstChild.textContent = label + ' ';

}

let toastTimer;
function toast( message ) {

	const el = document.getElementById( 'toast' );
	el.textContent = message;
	el.classList.add( 'show' );
	clearTimeout( toastTimer );
	toastTimer = setTimeout( () => el.classList.remove( 'show' ), 2200 );

}

const speedEl = document.getElementById( 'speed' );
const gearEl = document.getElementById( 'gear' );

function updateHUD() {

	const kmh = Math.abs( car.speed ) * 3.6;
	speedEl.textContent = Math.round( kmh );
	gearEl.textContent = car.speed < - 0.1 ? 'R' : car.speed > 0.1 ? 'D' : 'N';
	updateGarageButton();

}

// ---------------------------------------------------------------- cenário

function addCones() {

	const orange = new THREE.MeshStandardMaterial( { color: 0xff5a00, roughness: 0.6 } );
	const white = new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0.6 } );
	const coneGeo = new THREE.ConeGeometry( 0.17, 0.55, 16 );
	const stripeGeo = new THREE.CylinderGeometry( 0.088, 0.115, 0.1, 16 );
	const baseGeo = new THREE.BoxGeometry( 0.4, 0.04, 0.4 );

	const place = ( x, z ) => {

		const cone = new THREE.Group();
		const body = new THREE.Mesh( coneGeo, orange );
		body.position.y = 0.3;
		const stripe = new THREE.Mesh( stripeGeo, white );
		stripe.position.y = 0.33;
		const base = new THREE.Mesh( baseGeo, orange );
		base.position.y = 0.02;
		cone.add( body, stripe, base );
		cone.traverse( ( o ) => ( o.castShadow = o.receiveShadow = true ) );
		cone.position.set( x, 0, z );
		scene.add( cone );

	};

	// Slalom
	for ( let i = 0; i < 8; i ++ ) place( - 10, - 8 - i * 12 );
	// Pista oval delimitada por cones
	for ( let i = 0; i < 48; i ++ ) {

		const a = ( i / 48 ) * Math.PI * 2;
		place( 30 + Math.cos( a ) * 40, 40 + Math.sin( a ) * 22 );
		if ( i % 2 === 0 ) place( 30 + Math.cos( a ) * 30, 40 + Math.sin( a ) * 12 );

	}

}

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();

function loop() {

	frame( Math.min( clock.getDelta(), 0.05 ) );

}

function frame( dt ) {

	updateTweens( dt );
	car.update( dt, busy ? IDLE_INPUT : readInput(), [ ...garage.colliders, ...worldBounds ] );
	if ( garage.update( car ) ) toast( 'Portão reaberto: carro embaixo do portão' );
	updateCamera( dt );

	sun.position.copy( car.position ).add( tmp.set( 10, 18, 8 ) );
	sun.target.position.copy( car.position );

	updateHUD();
	renderer.render( scene, camera );

}

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

// Acesso pelo console para depuração
window.app = {
	scene, camera, car, garage, controls, THREE, actions,
	render: () => renderer.render( scene, camera ),
	COCKPIT_EYE,
	setCameraMode,
	// Avança a simulação manualmente (útil quando a aba está em segundo plano)
	tick( seconds = 1 ) {

		for ( let t = 0; t < seconds; t += 1 / 60 ) frame( 1 / 60 );

	},
};
