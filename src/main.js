import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Car } from './car/Car.js';
import { CAR_MODELS } from './car/models/index.js';
import { Character } from './character/Character.js';
import { spiderman } from './character/spiderman.js';
import { vanellope } from './character/vanellope.js';
import { Optimus } from './character/Optimus.js';
import { DANCE } from './character/dance.js';
import { VAI_TEIA } from './character/vaiTeia.js';
import { Garage } from './world/garage.js';
import { SugarRush } from './world/sugarRush.js';
import { LAYOUT } from './world/layout.js';
import { createPaddock } from './world/paddock.js';
import { animate, ease, updateTweens, wait } from './utils/tween.js';

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
scene.background = new THREE.Color( 0xbfe6f2 );
scene.fog = new THREE.Fog( 0xbfe6f2, 260, 1200 );

const environment = new HDRLoader().load( './textures/venice_sunset_1k.hdr' );
environment.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = environment;
scene.environmentIntensity = 0.9;

const camera = new THREE.PerspectiveCamera( 40, window.innerWidth / window.innerHeight, 0.05, 2500 );
camera.position.set( 4.25, 1.4, - 4.5 );

const controls = new OrbitControls( camera, renderer.domElement );
controls.enableDamping = true;
controls.maxDistance = 14;
controls.minDistance = 2.5;
controls.maxPolarAngle = THREE.MathUtils.degToRad( 88 );
controls.target.set( 0, 0.5, 0 );

const sun = new THREE.DirectionalLight( 0xfff0dd, 1.6 );
sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 );
sun.shadow.camera.left = sun.shadow.camera.bottom = - 16;
sun.shadow.camera.right = sun.shadow.camera.top = 16;
sun.shadow.camera.far = 80;
sun.shadow.bias = - 0.0004;
scene.add( sun, sun.target );

const world = new SugarRush();
scene.add( world.object );

const garage = new Garage( LAYOUT.garage );
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

const worldLimit = LAYOUT.worldLimit;
const worldBounds = [
	new THREE.Box2( new THREE.Vector2( - 400, - 400 ), new THREE.Vector2( 400, - worldLimit ) ),
	new THREE.Box2( new THREE.Vector2( - 400, worldLimit ), new THREE.Vector2( 400, 400 ) ),
	new THREE.Box2( new THREE.Vector2( - 400, - 400 ), new THREE.Vector2( - worldLimit, 400 ) ),
	new THREE.Box2( new THREE.Vector2( worldLimit, - 400 ), new THREE.Vector2( 400, 400 ) ),
];

const cars = Object.values( CAR_MODELS ).map( ( model ) => {

	const c = new Car( model );
	const start = LAYOUT.cars[ model.id ] ?? { position: new THREE.Vector3(), yaw: 0 };
	c.object.position.copy( start.position );
	c.object.rotation.y = start.yaw;
	scene.add( c.object );
	return c;

} );

let car = cars.find( ( c ) => c.model.id === 'porsche' ) ?? cars[ 0 ];

// Personagens jogáveis (a pé ou dirigindo). Só um é controlado por vez (`hero`); cada um lembra em
// qual carro está sentado (`seatedIn`), e o outro fica parado onde foi deixado.
const heroes = [ spiderman, vanellope ].map( ( model ) => {

	const h = new Character( model );
	const start = LAYOUT.characters[ model.id ];
	h.object.position.copy( start.position );
	h.object.rotation.y = start.yaw;
	h.seatedIn = null;
	scene.add( h.object );
	return h;

} );
const spider = heroes[ 0 ];
let hero = spider;
let onFoot = true;

// O Optimus fica no mundo à parte: não colide com os carros (nem eles com ele).
const optimus = new Optimus();
optimus.object.position.copy( LAYOUT.optimus.position );
optimus.object.rotation.y = LAYOUT.optimus.yaw;
scene.add( optimus.object );
let piloting = false;

const controlled = () => ( piloting ? optimus : onFoot ? hero : car );

const loadingBar = document.getElementById( 'loading-bar' );
const loadables = [ world, ...cars, ...heroes, optimus ];
const progress = loadables.map( () => 0 );

Promise.all( loadables.map( ( c, i ) => c.load( ( p ) => {

	progress[ i ] = p;
	loadingBar.style.width = `${ progress.reduce( ( a, b ) => a + b ) / loadables.length * 100 }%`;

} ) ) ).then( () => {

	placeOnTrack();
	for ( const c of cars ) createCarLabel( c );
	setQuality( QUALITY[ savedQuality ] ? savedQuality : 'alto' );
	syncPanel();
	setCameraMode( cameraMode );
	document.getElementById( 'loading' ).classList.add( 'done' );
	renderer.setAnimationLoop( loop );

} ).catch( ( err ) => {

	console.error( err );
	document.querySelector( '.loading-title' ).textContent = 'Erro ao carregar o modelo: ' + err.message;

} );

const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, run: false };
const IDLE_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: false };

window.addEventListener( 'keydown', ( e ) => {

	if ( e.target.tagName === 'INPUT' ) return;
	if ( [ 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space' ].includes( e.code ) ) e.preventDefault();
	if ( e.repeat ) return;

	keys.add( e.code );

	if ( piloting ) {

		if ( e.code === 'KeyC' ) setCameraMode( CAMERA_MODES[ ( CAMERA_MODES.indexOf( cameraMode ) + 1 ) % CAMERA_MODES.length ] );
		else if ( e.code === 'KeyR' ) actions.transform();
		return;

	}

	switch ( e.code ) {

		case 'KeyL': actions.lights(); break;
		case 'KeyH': actions.hazards(); break;
		case 'KeyC': setCameraMode( CAMERA_MODES[ ( CAMERA_MODES.indexOf( cameraMode ) + 1 ) % CAMERA_MODES.length ] ); break;
		case 'KeyG': actions.garage(); break;
		case 'KeyQ': actions[ 'door-left' ](); break;
		case 'KeyE': actions[ 'door-right' ](); break;
		case 'KeyT': if ( ! onFoot ) selectCar( cars[ ( cars.indexOf( car ) + 1 ) % cars.length ] ); break;
		case 'KeyF': actions.vehicle(); break;
		case 'KeyB': actions.dance(); break;
		case 'KeyV': actions.web(); break;

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
	input.run = has( 'ShiftLeft', 'ShiftRight' );
	return input;

}

const heroInput = { move: new THREE.Vector3(), turn: 0, run: false, jump: false, lockFacing: false };
const IDLE_HERO_INPUT = { move: new THREE.Vector3(), turn: 0, run: false, jump: false, lockFacing: false };
const ahead = new THREE.Vector3();

function readHeroInput( who = hero ) {

	const i = busy ? IDLE_INPUT : readInput();
	const forward = i.throttle - i.brake;
	heroInput.run = !! i.run;
	heroInput.jump = !! i.handbrake;
	heroInput.lockFacing = cameraMode !== 'orbit';

	if ( heroInput.lockFacing ) {

		heroInput.turn = i.steer;
		who.forward( heroInput.move ).multiplyScalar( forward );

	} else {

		heroInput.turn = 0;
		camera.getWorldDirection( ahead ).setY( 0 ).normalize();
		heroInput.move.copy( ahead ).multiplyScalar( forward ).add( tmp.set( ahead.z, 0, - ahead.x ).multiplyScalar( i.steer ) );
		if ( heroInput.move.lengthSq() > 1 ) heroInput.move.normalize();

	}

	return heroInput;

}

const CAMERA_MODES = [ 'orbit', 'chase', 'cockpit' ];
let cameraMode = 'orbit';
const lastCarPosition = new THREE.Vector3();
const tmp = new THREE.Vector3();

function setCameraMode( mode ) {

	cameraMode = mode;
	controls.enabled = mode === 'orbit';
	camera.fov = mode === 'cockpit' ? 62 : 40;
	camera.updateProjectionMatrix();

	controls.maxDistance = piloting ? 40 : 14;

	if ( mode === 'orbit' ) {

		const t = controlled();
		if ( piloting ) {

			const h = optimus.height;
			controls.target.copy( t.position ).setY( t.position.y + h * 0.5 );
			camera.position.copy( t.object.localToWorld( tmp.set( h * 1.4, h * 0.8, h * 2.6 ) ) );

		} else {

			controls.target.copy( t.position ).setY( t.position.y + ( onFoot ? 1.1 : 0.5 ) );
			camera.position.copy( t.object.localToWorld( onFoot ? tmp.set( 1.6, 2.0, 3.6 ) : tmp.set( 4.5, 1.6, - 4.5 ) ) );

		}
		lastCarPosition.copy( t.position );

	}

	setActive( 'camera', mode );

}

const cameraProbe = new THREE.Vector3();

// Puxa a câmera de perseguição para frente quando ela entraria nas ilhas/doces (usa o mapa de
// obstáculos do terreno em vez de raycast nas malhas, que seria caro a cada quadro).
function keepCameraClear( from, to ) {

	const terrain = world.terrain;
	if ( ! terrain ) return to;

	const steps = Math.ceil( from.distanceTo( to ) / 0.4 );
	for ( let i = 1; i <= steps; i ++ ) {

		cameraProbe.lerpVectors( from, to, i / steps );
		if ( terrain.solidBetween( cameraProbe.x, cameraProbe.z, cameraProbe.y - 0.4, cameraProbe.y + 0.4 ) ) return to.lerpVectors( from, to, Math.max( 0, i - 1.5 ) / steps );

	}

	return to;

}

function updateCamera( dt ) {

	const t = controlled();
	const delta = tmp.subVectors( t.position, lastCarPosition );
	lastCarPosition.copy( t.position );

	if ( cameraMode === 'orbit' ) {

		// O Optimus muda de altura ao se transformar; a câmera acompanha.
		if ( piloting ) delta.y = ( optimus.position.y + optimus.height * 0.5 - controls.target.y ) * ( 1 - Math.exp( - dt * 2 ) );
		camera.position.add( delta );
		controls.target.add( delta );
		if ( piloting ) {

			const away = camera.position.clone().sub( controls.target );
			const min = optimus.height * 1.8;
			if ( away.length() < min ) camera.position.copy( controls.target ).add( away.setLength( THREE.MathUtils.lerp( away.length(), min, 1 - Math.exp( - dt * 2 ) ) ) );

		}
		controls.update();

	} else if ( piloting && cameraMode === 'chase' ) {

		const h = optimus.height;
		const desired = keepCameraClear( optimus.object.localToWorld( new THREE.Vector3( 0, h * 0.6, 0 ) ), optimus.object.localToWorld( tmp.set( 0, h * 0.9, h * 2.2 ) ) );
		camera.position.lerp( desired, 1 - Math.exp( - dt * 4 ) );
		camera.lookAt( optimus.object.localToWorld( tmp.set( 0, h * 0.55, - h ) ) );

	} else if ( piloting ) {

		const eye = optimus.eyePosition( new THREE.Vector3() );
		camera.position.copy( eye );
		camera.lookAt( eye.addScaledVector( optimus.forward( tmp ), 10 ).setY( eye.y - 1 ) );

	} else if ( onFoot && cameraMode === 'chase' ) {

		const desired = keepCameraClear( hero.object.localToWorld( new THREE.Vector3( 0, 1.6, 0 ) ), hero.object.localToWorld( new THREE.Vector3( 0, 2.1, 3.8 ) ).setY( hero.position.y + 2.1 ) );
		camera.position.lerp( desired, 1 - Math.exp( - dt * 6 ) );
		camera.lookAt( hero.object.localToWorld( new THREE.Vector3( 0, 1.2, - 2 ) ).setY( hero.position.y + 1.2 ) );

	} else if ( onFoot ) {

		const eye = hero.eyePosition( new THREE.Vector3() );
		camera.position.copy( eye );
		camera.lookAt( eye.addScaledVector( hero.forward(), 5 ).setY( eye.y - 0.4 ) );

	} else if ( cameraMode === 'chase' ) {

		const inside = garage.contains( car.position );
		// Segue a inclinação do carro (car.tilt) para não entrar no chão em subidas/descidas.
		const desired = keepCameraClear( car.tilt.localToWorld( new THREE.Vector3( 0, 1.2, 0 ) ), car.tilt.localToWorld( new THREE.Vector3( 0, inside ? 1.9 : 2, inside ? 3.8 : 6.2 ) ) );
		camera.position.lerp( desired, 1 - Math.exp( - dt * 5 ) );
		camera.lookAt( car.tilt.localToWorld( new THREE.Vector3( 0, 0.7, - 2 ) ) );

	} else {

		const eye = car.model.cockpitEye;
		camera.position.copy( car.chassis.localToWorld( eye.clone() ) );
		camera.lookAt( car.chassis.localToWorld( new THREE.Vector3( eye.x, 0.95, - 5 ) ) );

	}

}

let busy = false;

const actions = {

	'door-left': () => toggleDoor( 'left' ),
	'door-right': () => toggleDoor( 'right' ),

	lights() {

		if ( onFoot ) return;
		car.setHeadlights( ! car.headlightsOn );
		setActiveAction( 'lights', car.headlightsOn );

	},

	hazards() {

		if ( onFoot ) return;
		car.setHazards( ! car.hazardsOn );
		setActiveAction( 'hazards', car.hazardsOn );

	},

	garage() {

		if ( busy ) return;
		if ( onFoot ) return toggleGarageDoor();
		if ( garage.contains( car.position ) ) leaveGarage();
		else if ( car.position.distanceTo( garage.object.position ) > 45 ) toast( 'A garagem fica no gramado, no pé da rampa: chegue mais perto' );
		else if ( cars.some( ( c ) => c !== car && garage.contains( c.position ) ) ) toast( 'A garagem já está ocupada por outro carro' );
		else goToGarage();

	},

	dance: () => playRoutine( 'dance' ),
	web: () => playRoutine( 'web' ),

	transform() {

		if ( ! piloting ) return;
		if ( Math.abs( optimus.speed ) > 0.5 ) return toast( 'Pare o Optimus para se transformar' );
		if ( ! optimus.transform() ) return;
		autobotsAudio.pause();
		syncPanel();

	},

	vehicle() {

		if ( busy ) return;
		if ( ! onFoot ) return exitCar();
		const near = nearestCar();
		if ( near ) enterCar( near );
		else toast( 'Chegue perto de um carro para entrar (F)' );

	},

};

function toggleDoor( side ) {

	if ( busy || onFoot ) return;
	if ( Math.abs( car.speed ) > 0.5 ) return toast( 'Pare o carro para abrir as portas' );
	car.toggleDoor( side );
	setActiveAction( `door-${ side }`, car.isDoorOpen( side ) );

}

function toggleGarageDoor() {

	const open = ! garage.doorTarget;
	if ( open ) garage.setLight( true );
	garage.setDoor( open ).then( ( finished ) => finished && ! open && garage.setLight( false ) );

}

const ROUTINES = {
	dance: { routine: DANCE, audio: new Audio( './audio/spiderman-dance.mp3' ) },
	web: { routine: VAI_TEIA, audio: new Audio( './audio/vai-teia.wav' ) },
};
for ( const r of Object.values( ROUTINES ) ) r.audio.preload = 'auto';
let playing = null;

function playRoutine( name ) {

	if ( ! onFoot || busy ) return;
	if ( hero !== spider ) return toast( 'Essa é do Homem-Aranha' );
	const was = playing;
	if ( hero.dancing ) hero.stopDance();
	if ( was === name || ! hero.grounded ) return;

	const { routine, audio } = ROUTINES[ name ];
	audio.currentTime = 0;
	const started = performance.now();
	audio.play().catch( () => {} );
	playing = name;
	hero.startDance( () => ( audio.paused ? ( performance.now() - started ) / 1000 : audio.currentTime ), routine );
	setActiveAction( name, true );

}

spider.onDanceEnd = () => {

	ROUTINES[ playing ]?.audio.pause();
	if ( playing ) setActiveAction( playing, false );
	playing = null;

};

spider.onRoutineEvent = ( name ) => name === 'web' && shootWeb();

const autobotsAudio = new Audio( './audio/autobots-vamos-rodar.mp3' );
autobotsAudio.preload = 'auto';

optimus.onTransformEnd = ( form ) => {

	if ( form === 'robot' ) {

		autobotsAudio.currentTime = 0;
		autobotsAudio.play().catch( () => {} );

	}
	syncPanel();

};

const webMaterial = new THREE.MeshStandardMaterial( { color: 0xf4f4f4, roughness: 0.6, emissive: 0x666666, transparent: true } );
const webRay = new THREE.Raycaster();
let webCount = 0;

function shootWeb() {

	const from = spider.bones.RightHand.getWorldPosition( new THREE.Vector3() );
	const elbow = spider.bones.RightForeArm.getWorldPosition( new THREE.Vector3() );
	const dir = from.clone().sub( elbow ).setY( 0 ).normalize().setY( 0.05 ).normalize();

	webRay.set( from, dir );
	webRay.far = 30;
	const hit = webRay.intersectObjects( [ garage.object, ...cars.map( ( c ) => c.root ) ], true ).find( ( h ) => h.object.visible && h.object.material.visible );
	const length = hit ? hit.distance : 30;

	const web = new THREE.Group();
	const strand = new THREE.Mesh( new THREE.CylinderGeometry( 0.012, 0.012, 1, 6 ), webMaterial.clone() );
	strand.rotation.x = Math.PI / 2;
	strand.position.z = 0.5;
	web.add( strand );

	const blob = new THREE.Mesh( new THREE.IcosahedronGeometry( 0.06, 1 ), strand.material );
	web.add( blob );

	web.position.copy( from );
	web.lookAt( from.clone().add( dir ) );
	scene.add( web );

	animate( {
		key: `web-${ ++ webCount }`, from: 0, to: 1, duration: 1.4, easing: ease.linear,
		onUpdate: ( v ) => {

			const grow = Math.min( 1, v / 0.12 );
			web.scale.set( 1, 1, Math.max( grow * length, 0.01 ) );
			blob.scale.set( 1, 1, 1 / Math.max( grow * length, 0.01 ) );
			blob.position.z = 1;
			strand.material.opacity = v < 0.7 ? 1 : 1 - ( v - 0.7 ) / 0.3;

		},
	} ).then( () => {

		web.removeFromParent();
		strand.geometry.dispose();
		blob.geometry.dispose();
		strand.material.dispose();

	} );

}

function nearestCar() {

	let best = null, bestDistance = Infinity;

	for ( const c of cars ) {

		const d = c.position.distanceTo( hero.position ) - c.model.halfLength;
		if ( d < 1.8 && d < bestDistance ) {

			best = c;
			bestDistance = d;

		}

	}

	return best;

}

const GRIP_RADIUS = 0.17;

function steeringGrip( c = car ) {

	const wheel = c.steeringWheel;
	wheel.updateWorldMatrix( true, false );
	const center = wheel.getWorldPosition( new THREE.Vector3() );
	const side = new THREE.Vector3( 1, 0, 0 ).applyQuaternion( wheel.getWorldQuaternion( new THREE.Quaternion() ) ).multiplyScalar( GRIP_RADIUS );
	return [ center.clone().sub( side ), center.add( side ) ];

}

const seatRay = new THREE.Raycaster();

function seatPosition( c ) {

	const eye = c.model.cockpitEye;
	c.chassis.updateWorldMatrix( true, true );

	const cast = ( from, dir ) => {

		seatRay.set( c.chassis.localToWorld( from ), dir.transformDirection( c.chassis.matrixWorld ) );
		seatRay.far = 1.2;
		const hit = seatRay.intersectObject( c.root, true ).find( ( h ) => h.object.visible && h.object.material.visible && h.object.parent.visible && ! h.object.isSkinnedMesh );
		return hit && c.chassis.worldToLocal( hit.point.clone() );

	};

	const back = cast( new THREE.Vector3( eye.x, eye.y - 0.45, eye.z - 0.3 ), new THREE.Vector3( 0, 0, 1 ) );
	const backZ = back ? back.z : eye.z + 0.2;
	const cushion = cast( new THREE.Vector3( eye.x, eye.y - 0.15, backZ - 0.2 ), new THREE.Vector3( 0, - 1, 0 ) );
	const seatY = cushion ? cushion.y : eye.y - 0.7;

	return new THREE.Vector3( eye.x, seatY + 0.1, backZ - 0.13 );

}

function enterCar( next ) {

	const occupant = heroes.find( ( h ) => h !== hero && h.seatedIn === next );
	if ( occupant ) return toast( `${ occupant.model.name } está nesse carro` );

	return runSequence( `Entrando: ${ next.model.name }…`, async () => {

		const near = hero.position.distanceTo( next.position ) < next.model.halfLength + 2;
		if ( near && ! next.isDoorOpen( 'left' ) ) await next.setDoor( 'left', true );

		hero.stopDance();
		hero.sit( next.chassis, seatPosition( next ) );
		hero.seatedIn = next;
		onFoot = false;
		car = next;
		syncPanel();
		setCameraMode( cameraMode );

		await wait( 0.15 );
		await closeCarDoors();

	} );

}

function exitCar() {

	if ( Math.abs( car.speed ) > 0.5 ) return toast( 'Pare o carro para sair' );

	return runSequence( 'Saindo do carro…', async () => {

		await car.setDoor( 'left', true );

		const ground = terrainBlockers.hero;
		ground.y = car.position.y;
		const blockers = [ ...garage.colliders, ...worldBounds, ground, ...cars.filter( ( c ) => c !== car ).map( ( c ) => c.footprint() ) ];
		const spot = new THREE.Vector3();
		let yaw = car.yaw + Math.PI / 2;
		for ( const side of [ - 1, 1 ] ) {

			spot.copy( car.object.localToWorld( new THREE.Vector3( side * ( car.model.halfWidth + 0.55 ), 0, 0.1 ) ) ).setY( car.position.y );
			yaw = car.yaw + side * - Math.PI / 2;
			hero.position.copy( spot );
			if ( ! hero.collides( blockers ) ) break;

		}

		hero.stand( scene, spot, yaw );
		hero.seatedIn = null;
		onFoot = true;
		syncPanel();
		setCameraMode( cameraMode );

		await wait( 0.3 );
		await closeCarDoors();

	} );

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

		const forward = car.forward();
		const reverse = forward.z < 0;
		const travel = reverse ? forward.negate() : forward;
		const e = garage.entrance;
		const exit = new THREE.Vector3( e.x + 3.5, 0, e.z + 8.5 );
		const exitDir = new THREE.Vector3( 0.45, 0, 1 ).normalize();

		await car.followPath( bezier( car.position.clone(), travel, exit, exitDir, 3, 3 ), { maxSpeed: 3, reverse } );

		garage.setDoor( false ).then( ( finished ) => finished && garage.setLight( false ) );

	} );

}

function bezier( p0, t0, p1, t1, d0, d1 ) {

	return new THREE.CubicBezierCurve3(
		p0,
		p0.clone().addScaledVector( t0, d0 ),
		p1.clone().addScaledVector( t1, - d1 ),
		p1
	);

}

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

function routeToGarage() {

	const p = car.position.clone();
	const h = car.forward();
	const e = garage.entrance;
	const park = garage.parkSpot.clone();
	const inward = new THREE.Vector3( 0, 0, - 1 );
	const staging = new THREE.Vector3( e.x, 0, e.z + 9 );
	const span = ( a, b ) => THREE.MathUtils.clamp( a.distanceTo( b ) * 0.4, 1, 10 );

	const inCorridor = Math.abs( p.x - e.x ) < 2 && p.z > e.z - 0.5 && p.z < staging.z + 1;

	if ( inCorridor && h.z < - 0.7 ) {

		return { path: bezier( p, h, park, inward, span( p, park ), span( p, park ) ), reverse: false };

	}

	if ( inCorridor && h.z > 0.7 ) {

		return { path: bezier( p, h.clone().negate(), park, inward, span( p, park ), span( p, park ) ), reverse: true };

	}

	const path = new THREE.CurvePath();

	if ( p.z < e.z + 1 ) {

		const side = p.x >= e.x ? 1 : - 1;
		const around = new THREE.Vector3( e.x + side * 10, 0, e.z + 2 );
		const north = new THREE.Vector3( 0, 0, 1 );

		if ( p.z < garage.object.position.z ) {

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

function selectCar( next ) {

	if ( next === optimus || piloting ) {

		if ( busy ) return toast( 'Aguarde' );
		if ( optimus.transforming ) return toast( 'Aguarde a transformação terminar' );
		if ( next === optimus && ! piloting && ! onFoot && Math.abs( car.speed ) > 0.5 ) return toast( 'Pare o carro antes de trocar' );
		if ( next === optimus && piloting ) return setActive( 'car', 'optimus' );

		piloting = next === optimus;
		if ( piloting ) {

			car.speed = Math.abs( car.speed ) < 0.5 ? 0 : car.speed;
			toast( 'Optimus Prime: R para transformar' );

		} else {

			optimus.speed = 0;
			// Volta para o Homem-Aranha (a pé ou no carro em que ele está) e segue com a troca pedida.
			syncPanel();
			setCameraMode( cameraMode );
			if ( next !== hero && ( onFoot || next !== car ) ) return selectCar( next );
			if ( next === hero && ! onFoot ) return exitCar();
			setActive( 'car', controlled().model.id );
			return;

		}

		syncPanel();
		setCameraMode( cameraMode );
		return;

	}

	const occupant = heroes.find( ( h ) => h !== hero && h.seatedIn === next );

	if ( heroes.includes( next ) && next !== hero ) {

		// Troca de personagem: o atual fica onde está (a pé ou sentado no carro, parado).
		if ( busy ) toast( 'Aguarde' );
		else if ( ! onFoot && Math.abs( car.speed ) > 0.5 ) toast( 'Pare o carro antes de trocar' );
		else {

			if ( ! onFoot ) car.speed = 0;
			hero.stopDance();
			hero = next;
			onFoot = ! hero.seatedIn;
			if ( hero.seatedIn ) car = hero.seatedIn;
			syncPanel();
			setCameraMode( cameraMode );
			toast( onFoot ? `Controlando: ${ hero.model.name }` : `${ hero.model.name } dirigindo: ${ car.model.name }` );

		}

	} else if ( next === hero ) {

		if ( ! onFoot && ! busy ) exitCar();

	} else if ( occupant ) {

		toast( `${ occupant.model.name } está nesse carro: troque para ${ occupant.model.name } para dirigir` );

	} else if ( next && onFoot ) {

		if ( busy ) toast( 'Aguarde' );
		else enterCar( next );

	} else if ( next && next !== car ) {

		if ( busy ) toast( 'Aguarde a manobra terminar' );
		else if ( Math.abs( car.speed ) > 0.5 ) toast( 'Pare o carro antes de trocar' );
		else {

			car.speed = 0;
			car = next;
			hero.sit( car.chassis, seatPosition( car ) );
			hero.seatedIn = car;
			lastCarPosition.copy( car.position );
			syncPanel();
			setCameraMode( cameraMode );
			toast( `Dirigindo: ${ car.model.name } ${ car.model.subtitle }` );

		}

	}

	setActive( 'car', controlled().model.id );

}

function syncPanel() {

	const panel = document.getElementById( 'panel' );
	panel.classList.toggle( 'on-foot', onFoot );
	panel.classList.toggle( 'optimus', piloting );
	panel.classList.toggle( 'spiderman', hero === spider );
	panel.classList.toggle( 'no-custom', ! onFoot && car.model.customizable === false );
	setActive( 'car', controlled().model.id );
	if ( piloting ) {

		document.getElementById( 'car-title' ).innerHTML = `${ optimus.model.name } <span>${ optimus.subtitle }</span>`;
		return;

	}
	if ( onFoot ) {

		document.getElementById( 'car-title' ).innerHTML = `${ hero.model.name } <span>${ hero.model.subtitle }</span>`;
		return;

	}

	const m = car.model;
	document.getElementById( 'car-title' ).innerHTML = `${ m.name } <span>${ m.subtitle }</span>`;
	document.getElementById( 'spoiler-options' ).hidden = ! m.spoilers;
	document.getElementById( 'paint-custom' ).value = car.settings.paint;
	for ( const [ option, value ] of Object.entries( car.settings ) ) setActive( option, value );
	setActive( 'car', m.id );

	setActiveAction( 'lights', car.headlightsOn );
	setActiveAction( 'hazards', car.hazardsOn );
	setActiveAction( 'door-left', car.isDoorOpen( 'left' ) );
	setActiveAction( 'door-right', car.isDoorOpen( 'right' ) );

}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;

function carUnderPointer( e ) {

	pointer.set( ( e.clientX / window.innerWidth ) * 2 - 1, - ( e.clientY / window.innerHeight ) * 2 + 1 );
	raycaster.setFromCamera( pointer, camera );
	const hit = raycaster.intersectObjects( cars.filter( ( c ) => c.hitBox ).map( ( c ) => c.hitBox ), false )[ 0 ];
	return hit?.object.userData.car;

}

renderer.domElement.addEventListener( 'pointerdown', ( e ) => ( pointerDown = { x: e.clientX, y: e.clientY } ) );

renderer.domElement.addEventListener( 'pointerup', ( e ) => {

	if ( pointerDown && Math.hypot( e.clientX - pointerDown.x, e.clientY - pointerDown.y ) < 5 ) {

		const hit = carUnderPointer( e );
		if ( hit ) selectCar( hit );

	}

	pointerDown = null;

} );

renderer.domElement.addEventListener( 'pointermove', ( e ) => {

	if ( e.buttons ) return;
	const hit = carUnderPointer( e );
	renderer.domElement.style.cursor = hit && hit !== car ? 'pointer' : '';

} );

const labelPosition = new THREE.Vector3();

function createCarLabel( c ) {

	const el = document.createElement( 'div' );
	el.className = 'car-label';
	el.innerHTML = `${ c.model.name } ${ c.model.subtitle }<small></small>`;
	el.hidden = true;
	el.addEventListener( 'click', () => selectCar( c ) );
	container.after( el );
	c.label = el;

}

function updateCarLabels() {

	for ( const c of cars ) {

		if ( ! c.label ) continue;

		labelPosition.copy( c.position ).setY( c.position.y + 1.75 );
		const distance = labelPosition.distanceTo( camera.position );
		labelPosition.project( camera );

		const visible = ( onFoot || c !== car ) && labelPosition.z < 1 && distance < 45 && Math.abs( labelPosition.x ) < 1.1 && Math.abs( labelPosition.y ) < 1.1;
		c.label.hidden = ! visible;
		if ( ! visible ) continue;

		const hint = onFoot && c === nearestCar() ? 'F para entrar' : 'clique para dirigir';
		const small = c.label.lastChild;
		if ( small.textContent !== hint ) small.textContent = hint;

		const x = ( labelPosition.x + 1 ) / 2 * window.innerWidth;
		const y = ( 1 - labelPosition.y ) / 2 * window.innerHeight;
		c.label.style.transform = `translate(-50%, -100%) translate(${ x }px, ${ y }px)`;

	}

}

const carOptions = document.querySelector( '[data-option="car"]' );
for ( const c of [ ...heroes, ...cars, optimus ] ) {

	const button = document.createElement( 'button' );
	button.dataset.value = c.model.id;
	button.textContent = c.model.name;
	carOptions.appendChild( button );

}

const optionHandlers = {
	car: ( v ) => selectCar( [ ...heroes, ...cars, optimus ].find( ( c ) => c.model.id === v ) ),
	camera: setCameraMode,
	quality: ( v ) => {

		perf.auto = false;
		setQuality( v );
		try {

			localStorage.setItem( 'quality', v );

		} catch {}

	},
	paint: ( v ) => {

		car.setPaint( v );
		document.getElementById( 'paint-custom' ).value = v;

	},
	finish: ( v ) => car.setPaintFinish( v ),
	rims: ( v ) => car.setRims( v ),
	calipers: ( v ) => car.setCalipers( v ),
	glass: ( v ) => car.setGlass( v ),
	interior: ( v ) => car.setInterior( v ),
	suspension: ( v ) => car.setSuspension( v ),
};

document.querySelectorAll( '[data-option]' ).forEach( ( group ) => {

	group.addEventListener( 'click', ( e ) => {

		const button = e.target.closest( 'button[data-value]' );
		if ( ! button ) return;
		const option = group.dataset.option;
		setActive( option, button.dataset.value );
		optionHandlers[ option ]( button.dataset.value );
		if ( option === 'car' ) setActive( 'car', controlled().model.id );
		else if ( option in car.settings ) car.settings[ option ] = button.dataset.value;
		button.blur();

	} );

} );

document.getElementById( 'paint-custom' ).addEventListener( 'input', ( e ) => {

	car.setPaint( e.target.value );
	car.settings.paint = e.target.value;
	setActive( 'paint', null );

} );

document.querySelectorAll( '[data-action]' ).forEach( ( button ) => {

	button.addEventListener( 'click', () => {

		if ( piloting === ( button.dataset.action === 'transform' ) ) actions[ button.dataset.action ]();
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

function updateActionLabels() {

	const setLabel = ( action, label ) => {

		const button = document.querySelector( `[data-action="${ action }"]` );
		if ( button.firstChild.textContent.trim() !== label ) button.firstChild.textContent = label + ' ';

	};

	if ( onFoot ) setLabel( 'garage', garage.doorTarget ? 'Fechar portão' : 'Abrir portão' );
	else setLabel( 'garage', garage.contains( car.position ) ? 'Sair da garagem' : 'Ir para a garagem' );
	setLabel( 'vehicle', onFoot ? 'Entrar no carro' : 'Sair do carro' );
	setLabel( 'transform', optimus.form === 'robot' ? 'Virar caminhão' : optimus.transforming ? 'Transformando…' : 'Transformar' );

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

	const t = controlled();
	speedEl.textContent = Math.round( Math.abs( t.speed ) * 3.6 );
	gearEl.hidden = piloting ? optimus.form !== 'truck' : onFoot;
	gearEl.textContent = t.speed < - 0.1 ? 'R' : t.speed > 0.1 ? 'D' : 'N';
	updateActionLabels();

}

function addCones() {

	const orange = new THREE.MeshStandardMaterial( { color: 0xff5a00, roughness: 0.6 } );
	const white = new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0.6 } );
	const coneGeo = new THREE.ConeGeometry( 0.17, 0.55, 16 );
	const stripeGeo = new THREE.CylinderGeometry( 0.088, 0.115, 0.1, 16 );
	const baseGeo = new THREE.BoxGeometry( 0.4, 0.04, 0.4 );

	const spots = [];
	const place = ( x, z ) => spots.push( [ x, z ] );

	// Slalom no gramado: cones em linha, com um par de "portões" nas pontas.
	const { from, to, spacing, weave } = LAYOUT.cones;
	const length = from.distanceTo( to );
	const along = to.clone().sub( from ).normalize();
	const side = new THREE.Vector3( - along.z, 0, along.x );
	for ( let d = 0; d <= length; d += spacing ) place( from.x + along.x * d, from.z + along.z * d );
	for ( const end of [ from, to ] ) for ( const s of [ - 1, 1 ] ) place( end.x + side.x * weave * s, end.z + side.z * weave * s );

	const matrix = new THREE.Matrix4();
	for ( const [ geometry, material, y ] of [ [ coneGeo, orange, 0.3 ], [ stripeGeo, white, 0.33 ], [ baseGeo, orange, 0.02 ] ] ) {

		const parts = new THREE.InstancedMesh( geometry, material, spots.length );
		spots.forEach( ( [ x, z ], i ) => parts.setMatrixAt( i, matrix.makeTranslation( x, y, z ) ) );
		parts.castShadow = parts.receiveShadow = true;
		parts.computeBoundingSphere();
		scene.add( parts );

	}

}

const clock = new THREE.Clock();

function loop() {

	const dt = clock.getDelta();
	autoQuality( dt );
	frame( Math.min( dt, 0.05 ) );

}

const QUALITY = {
	baixo: { pixelRatio: 1, shadows: false, shadowSize: 1024, refractiveGlass: false },
	medio: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, refractiveGlass: false },
	alto: { pixelRatio: 2, shadows: true, shadowSize: 2048, refractiveGlass: true },
};
const QUALITY_ORDER = [ 'baixo', 'medio', 'alto' ];
let quality = null;

function setQuality( name ) {

	const q = QUALITY[ name ];
	const shadowsChanged = quality === null || q.shadows !== QUALITY[ quality ].shadows;
	quality = name;

	renderer.setPixelRatio( Math.min( window.devicePixelRatio, q.pixelRatio ) );
	renderer.setSize( window.innerWidth, window.innerHeight );

	renderer.shadowMap.enabled = q.shadows;
	sun.castShadow = q.shadows;
	if ( sun.shadow.mapSize.x !== q.shadowSize ) {

		sun.shadow.mapSize.set( q.shadowSize, q.shadowSize );
		sun.shadow.map?.dispose();
		sun.shadow.map = null;

	}

	refractiveGlass = q.refractiveGlass;
	updateGlass( true );

	if ( shadowsChanged ) scene.traverse( ( o ) => o.material && [ o.material ].flat().forEach( ( m ) => ( m.needsUpdate = true ) ) );

	setActive( 'quality', name );

}

let savedQuality = null;
try {

	savedQuality = localStorage.getItem( 'quality' );

} catch {}

const perf = { auto: ! QUALITY[ savedQuality ], skip: 1.5, time: 0, frames: 0 };

function autoQuality( dt ) {

	if ( ! perf.auto ) return;
	if ( document.hidden || dt > 0.25 ) return;
	if ( perf.skip > 0 ) return void ( perf.skip -= dt );

	perf.time += dt;
	perf.frames ++;
	if ( perf.time < 2.5 ) return;

	const average = perf.time / perf.frames;
	const level = QUALITY_ORDER.indexOf( quality );

	if ( average > 0.04 && level > 0 ) {

		setQuality( QUALITY_ORDER[ level - 1 ] );
		toast( `Gráficos ajustados para ${ document.querySelector( `[data-option="quality"] [data-value="${ quality }"]` ).textContent } (desempenho)` );
		Object.assign( perf, { skip: 1, time: 0, frames: 0 } );

	} else {

		perf.auto = false;

	}

}

// Vidro com refração faz o three.js desenhar a cena inteira mais uma vez (para o que aparece através
// do vidro). Com o cenário grande isso pesa, então só o carro perto da câmera usa esse vidro.
let refractiveGlass = false;
const GLASS_DISTANCE = 14;

function updateGlass( force = false ) {

	for ( const c of cars ) {

		const want = refractiveGlass && c.position.distanceTo( camera.position ) < GLASS_DISTANCE;
		if ( force || c.refractive !== want ) {

			c.refractive = want;
			c.setGlassQuality( want );

		}

	}

}

const staticColliders = [];
const colliders = [];
const carFootprints = cars.map( () => new THREE.Box2() );

// Relevo como colisor: cada um tem o seu degrau máximo, queda máxima (beirada) e altura do corpo.
const terrainBlockers = {};

// Coloca tudo na altura da praça de largada e liga o relevo à física de cada um.
function placeOnTrack() {

	const terrain = world.terrain;
	Object.assign( terrainBlockers, {
		car: terrain.blocker( { step: 1.2, drop: 1.5, height: 1.3 } ),
		hero: terrain.blocker( { step: 0.6, drop: 1.2, height: 1.7 } ),
		truck: terrain.blocker( { step: 1.4, drop: 1.8, height: 3.2 } ),
		robot: terrain.blocker( { step: 2, drop: 2, height: 3 } ),
	} );

	// Todos nascem na praça (a ponte do arco-íris passa por cima dela, por isso a referência é a praça).
	const plazaY = world.plaza.max.y;
	for ( const c of [ ...cars, ...heroes, optimus ] ) {

		c.terrain = terrain;
		c.object.position.y = terrain.height( c.position.x, c.position.z, plazaY, 1 );

	}

	scene.add( createPaddock( LAYOUT, plazaY ) );

}

function withTerrain( list, blocker, who ) {

	blocker.y = who.position.y;
	list.push( blocker );
	return list;

}

function frame( dt ) {

	updateTweens( dt );

	const t = controlled();
	const driven = onFoot ? null : car;

	// Colisores reaproveitados entre quadros para não gerar lixo a cada frame.
	staticColliders.length = 0;
	staticColliders.push( ...garage.colliders, ...worldBounds );
	colliders.length = 0;
	colliders.push( ...staticColliders );
	cars.forEach( ( c, i ) => c !== driven && colliders.push( c.footprint( carFootprints[ i ] ) ) );

	const truck = optimus.form === 'truck';
	if ( piloting ) optimus.update( dt, truck ? ( busy ? IDLE_INPUT : readInput() ) : readHeroInput( optimus ), withTerrain( staticColliders, terrainBlockers[ truck ? 'truck' : 'robot' ], optimus ) );
	else optimus.update( dt, optimus.form === 'truck' ? IDLE_INPUT : IDLE_HERO_INPUT );

	if ( onFoot ) {

		const i = piloting ? IDLE_HERO_INPUT : readHeroInput();
		if ( hero.dancing && ( i.move.lengthSq() > 0 || i.turn || i.jump ) ) hero.stopDance();
		hero.update( dt, i, withTerrain( colliders, terrainBlockers.hero, hero ) );
		colliders.pop();

	}
	else {

		car.update( dt, busy || piloting ? IDLE_INPUT : readInput(), withTerrain( colliders, terrainBlockers.car, car ) );
		colliders.pop();

	}
	if ( ! onFoot ) hero.update( dt, { hands: steeringGrip() } );
	hero.object.visible = piloting || onFoot || cameraMode !== 'cockpit';

	// Quem não está sendo controlado fica parado: sentado no carro dele ou de pé onde foi deixado.
	for ( const h of heroes ) {

		if ( h === hero ) continue;
		if ( h.seatedIn ) {

			h.update( dt, { hands: steeringGrip( h.seatedIn ) } );

		} else {

			h.update( dt, IDLE_HERO_INPUT, withTerrain( colliders, terrainBlockers.hero, h ) );
			colliders.pop();

		}

	}
	for ( const c of cars ) if ( c !== driven ) c.update( dt, IDLE_INPUT );

	if ( garage.update( t ) ) toast( onFoot ? 'Portão reaberto: tem alguém embaixo' : 'Portão reaberto: carro embaixo do portão' );
	updateCamera( dt );

	sun.position.copy( t.position ).add( tmp.set( 10, 18, 8 ) );
	sun.target.position.copy( t.position );

	for ( const c of cars ) c.updateDetail( camera.position );
	updateGlass();
	updateHUD();
	updateCarLabels();
	renderer.render( scene, camera );

}

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

window.app = {
	scene, camera, garage, controls, THREE, actions, cars, heroes, optimus, renderer, world,
	get hero() {

		return hero;

	},
	get onFoot() {

		return onFoot;

	},
	get car() {

		return car;

	},
	render: () => renderer.render( scene, camera ),
	selectCar,
	setCameraMode,
	tick( seconds = 1 ) {

		for ( let t = 0; t < seconds; t += 1 / 60 ) frame( 1 / 60 );

	},
};
