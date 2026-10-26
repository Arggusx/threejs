import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Car } from './car/Car.js';
import { CAR_MODELS } from './car/models/index.js';
import { Character } from './character/Character.js';
import { spiderman } from './character/spiderman.js';
import { Garage } from './world/garage.js';
import { updateTweens, wait } from './utils/tween.js';

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

// ---------------------------------------------------------------- carros

// Todos os carros ficam no mundo; só o selecionado (`car`) recebe os comandos
const START = {
	porsche: { position: new THREE.Vector3( 0, 0, 0 ), yaw: 0 },
	ferrari: { position: new THREE.Vector3( - 4.5, 0, 0 ), yaw: 0 },
};

const cars = Object.values( CAR_MODELS ).map( ( model ) => {

	const c = new Car( model );
	const start = START[ model.id ] ?? { position: new THREE.Vector3(), yaw: 0 };
	c.object.position.copy( start.position );
	c.object.rotation.y = start.yaw;
	scene.add( c.object );
	return c;

} );

let car = cars.find( ( c ) => c.model.id === 'porsche' ) ?? cars[ 0 ];

// Homem-Aranha: começa a pé, ao lado dos carros. Entra/sai de um carro com F.
const hero = new Character( spiderman );
hero.object.position.set( 2.4, 0, 3.2 );
scene.add( hero.object );
let onFoot = true;

// Quem recebe os comandos agora: o personagem ou o carro em que ele está
const controlled = () => ( onFoot ? hero : car );

const loadingBar = document.getElementById( 'loading-bar' );
const loadables = [ ...cars, hero ];
const progress = loadables.map( () => 0 );

Promise.all( loadables.map( ( c, i ) => c.load( ( p ) => {

	progress[ i ] = p;
	loadingBar.style.width = `${ progress.reduce( ( a, b ) => a + b ) / loadables.length * 100 }%`;

} ) ) ).then( () => {

	for ( const c of cars ) createCarLabel( c );
	syncPanel();
	setCameraMode( cameraMode );
	document.getElementById( 'loading' ).classList.add( 'done' );
	renderer.setAnimationLoop( loop );

} ).catch( ( err ) => {

	console.error( err );
	document.querySelector( '.loading-title' ).textContent = 'Erro ao carregar o modelo: ' + err.message;

} );

// ---------------------------------------------------------------- entrada

const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, run: false };
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
		case 'KeyT': if ( ! onFoot ) selectCar( cars[ ( cars.indexOf( car ) + 1 ) % cars.length ] ); break;
		case 'KeyF': actions.vehicle(); break;
		case 'KeyB': actions.dance(); break;

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

// Comandos do personagem. Na câmera livre o movimento é relativo à câmera; nas outras,
// W/S andam para a frente/trás e A/D giram (como um carro)
const heroInput = { move: new THREE.Vector3(), turn: 0, run: false, jump: false, lockFacing: false };

function readHeroInput() {

	const i = busy ? IDLE_INPUT : readInput();
	const forward = i.throttle - i.brake;
	heroInput.run = !! i.run;
	heroInput.jump = !! i.handbrake;
	heroInput.lockFacing = cameraMode !== 'orbit';

	if ( heroInput.lockFacing ) {

		heroInput.turn = i.steer;
		hero.forward( heroInput.move ).multiplyScalar( forward );

	} else {

		heroInput.turn = 0;
		const ahead = camera.getWorldDirection( new THREE.Vector3() ).setY( 0 ).normalize();
		const right = new THREE.Vector3( - ahead.z, 0, ahead.x );
		heroInput.move.copy( ahead ).multiplyScalar( forward ).addScaledVector( right, - i.steer );
		if ( heroInput.move.lengthSq() > 1 ) heroInput.move.normalize();

	}

	return heroInput;

}

// ---------------------------------------------------------------- câmera

const CAMERA_MODES = [ 'orbit', 'chase', 'cockpit' ];
let cameraMode = 'orbit';
const lastCarPosition = new THREE.Vector3();
const tmp = new THREE.Vector3();

function setCameraMode( mode ) {

	cameraMode = mode;
	controls.enabled = mode === 'orbit';
	camera.fov = mode === 'cockpit' ? 62 : 40;
	camera.updateProjectionMatrix();

	if ( mode === 'orbit' ) {

		const t = controlled();
		controls.target.copy( t.position ).setY( onFoot ? 1.1 : 0.5 );
		camera.position.copy( t.object.localToWorld( onFoot ? tmp.set( 1.6, 2.0, 3.6 ) : tmp.set( 4.5, 1.6, - 4.5 ) ) );
		lastCarPosition.copy( t.position );

	}

	setActive( 'camera', mode );

}

function updateCamera( dt ) {

	const t = controlled();
	const delta = tmp.subVectors( t.position, lastCarPosition );
	lastCarPosition.copy( t.position );

	if ( cameraMode === 'orbit' ) {

		// A câmera livre "anda junto" com o carro
		camera.position.add( delta );
		controls.target.add( delta );
		controls.update();

	} else if ( onFoot && cameraMode === 'chase' ) {

		const desired = hero.object.localToWorld( new THREE.Vector3( 0, 2.1, 3.8 ) ).setY( 2.1 );
		camera.position.lerp( desired, 1 - Math.exp( - dt * 6 ) );
		camera.lookAt( hero.object.localToWorld( new THREE.Vector3( 0, 1.2, - 2 ) ).setY( 1.2 ) );

	} else if ( onFoot ) {

		// Primeira pessoa: olhos do personagem
		const eye = hero.eyePosition( new THREE.Vector3() );
		camera.position.copy( eye );
		camera.lookAt( eye.addScaledVector( hero.forward(), 5 ).setY( eye.y - 0.4 ) );

	} else if ( cameraMode === 'chase' ) {

		const inside = garage.contains( car.position );
		const desired = car.object.localToWorld( new THREE.Vector3( 0, inside ? 1.9 : 1.7, inside ? 3.8 : 6.2 ) );
		camera.position.lerp( desired, 1 - Math.exp( - dt * 5 ) );
		camera.lookAt( car.object.localToWorld( new THREE.Vector3( 0, 0.7, - 2 ) ) );

	} else {

		const eye = car.model.cockpitEye; // olhos do motorista (espaço do chassi)
		camera.position.copy( car.chassis.localToWorld( eye.clone() ) );
		camera.lookAt( car.chassis.localToWorld( new THREE.Vector3( eye.x, 0.95, - 5 ) ) );

	}

}

// ---------------------------------------------------------------- ações

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
		else if ( cars.some( ( c ) => c !== car && garage.contains( c.position ) ) ) toast( 'A garagem já está ocupada por outro carro' );
		else goToGarage();

	},

	dance() {

		if ( ! onFoot || busy ) return;
		if ( hero.dancing ) return hero.stopDance();
		if ( ! hero.grounded ) return;

		danceAudio.currentTime = 0;
		const started = performance.now();
		danceAudio.play().catch( () => {} );
		// O relógio da dança é o tempo do áudio (se ele não tocar, usa o relógio do navegador)
		hero.startDance( () => ( danceAudio.paused ? ( performance.now() - started ) / 1000 : danceAudio.currentTime ) );
		setActiveAction( 'dance', true );

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

// A pé, G abre/fecha o portão (e acende/apaga a luz) — senão daria para ficar preso lá dentro
function toggleGarageDoor() {

	const open = ! garage.doorTarget;
	if ( open ) garage.setLight( true );
	garage.setDoor( open ).then( ( finished ) => finished && ! open && garage.setLight( false ) );

}

// ---------------------------------------------------------------- dança

const danceAudio = new Audio( './audio/spiderman-dance.mp3' );
danceAudio.preload = 'auto';

hero.onDanceEnd = () => {

	danceAudio.pause();
	setActiveAction( 'dance', false );

};

// ---------------------------------------------------------------- entrar / sair do carro

// Carro mais próximo ao alcance do personagem (ou null)
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

// Pontos do aro do volante (no mundo) onde ficam as mãos: "9h15", girando junto com o volante
const GRIP_RADIUS = 0.17;

function steeringGrip() {

	const wheel = car.steeringWheel;
	wheel.updateWorldMatrix( true, false );
	const center = wheel.getWorldPosition( new THREE.Vector3() );
	const side = new THREE.Vector3( 1, 0, 0 ).applyQuaternion( wheel.getWorldQuaternion( new THREE.Quaternion() ) ).multiplyScalar( GRIP_RADIUS );
	return [ center.clone().sub( side ), center.add( side ) ];

}

// Onde fica o quadril do motorista (espaço do chassi). Procura o encosto e o assento do banco com
// raios a partir dos olhos do cockpit, para o corpo não atravessar o banco.
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

	return runSequence( `Entrando: ${ next.model.name }…`, async () => {

		// Perto do carro: abre a porta do motorista, entra e fecha. Longe (pelo painel): só aparece lá dentro
		const near = hero.position.distanceTo( next.position ) < next.model.halfLength + 2;
		if ( near && ! next.isDoorOpen( 'left' ) ) await next.setDoor( 'left', true );

		hero.stopDance();
		hero.sit( next.chassis, seatPosition( next ) );
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

		// Aparece ao lado da porta do motorista (ou do passageiro, se ali estiver bloqueado)
		const blockers = [ ...garage.colliders, ...worldBounds, ...cars.filter( ( c ) => c !== car ).map( ( c ) => c.footprint() ) ];
		const spot = new THREE.Vector3();
		let yaw = car.yaw + Math.PI / 2;
		for ( const side of [ - 1, 1 ] ) {

			spot.copy( car.object.localToWorld( new THREE.Vector3( side * ( car.model.halfWidth + 0.55 ), 0, 0.1 ) ) ).setY( 0 );
			yaw = car.yaw + side * - Math.PI / 2;
			hero.position.copy( spot ); // só para testar a colisão nesse ponto
			if ( ! hero.collides( blockers ) ) break;

		}

		hero.stand( scene, spot, yaw );
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

// ---------------------------------------------------------------- seleção de carro

function selectCar( next ) {

	if ( next === hero ) {

		if ( ! onFoot && ! busy ) exitCar();

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
			lastCarPosition.copy( car.position );
			syncPanel();
			setCameraMode( cameraMode );
			toast( `Dirigindo: ${ car.model.name } ${ car.model.subtitle }` );

		}

	}

	setActive( 'car', controlled().model.id );

}

// Deixa o painel com os valores do carro selecionado
function syncPanel() {

	document.getElementById( 'panel' ).classList.toggle( 'on-foot', onFoot );
	setActive( 'car', controlled().model.id );
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

// Clique em um carro do mundo para dirigi-lo (só conta se o mouse não arrastou a câmera)
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

// Etiqueta com o nome sobre cada carro estacionado
const labelPosition = new THREE.Vector3();

function createCarLabel( c ) {

	const el = document.createElement( 'div' );
	el.className = 'car-label';
	el.innerHTML = `${ c.model.name } ${ c.model.subtitle }<small></small>`;
	el.hidden = true;
	el.addEventListener( 'click', () => selectCar( c ) );
	container.after( el ); // logo depois do canvas, para ficar por baixo do painel e do HUD
	c.label = el;

}

function updateCarLabels() {

	for ( const c of cars ) {

		if ( ! c.label ) continue;

		labelPosition.copy( c.position ).setY( 1.75 );
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

// ---------------------------------------------------------------- UI

// Botões de seleção de carro, gerados a partir dos modelos disponíveis
const carOptions = document.querySelector( '[data-option="car"]' );
for ( const c of [ hero, ...cars ] ) {

	const button = document.createElement( 'button' );
	button.dataset.value = c.model.id;
	button.textContent = c.model.name;
	carOptions.appendChild( button );

}

const optionHandlers = {
	car: ( v ) => selectCar( [ hero, ...cars ].find( ( c ) => c.model.id === v ) ),
	camera: setCameraMode,
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
		if ( option === 'car' ) setActive( 'car', controlled().model.id ); // a troca pode ter sido recusada
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

function updateActionLabels() {

	const setLabel = ( action, label ) => {

		const button = document.querySelector( `[data-action="${ action }"]` );
		if ( button.firstChild.textContent.trim() !== label ) button.firstChild.textContent = label + ' ';

	};

	if ( onFoot ) setLabel( 'garage', garage.doorTarget ? 'Fechar portão' : 'Abrir portão' );
	else setLabel( 'garage', garage.contains( car.position ) ? 'Sair da garagem' : 'Ir para a garagem' );
	setLabel( 'vehicle', onFoot ? 'Entrar no carro' : 'Sair do carro' );

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
	gearEl.hidden = onFoot;
	gearEl.textContent = car.speed < - 0.1 ? 'R' : car.speed > 0.1 ? 'D' : 'N';
	updateActionLabels();

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

	// Quem está no controle colide com a garagem, os limites do mundo e os carros parados
	const t = controlled();
	const others = cars.filter( ( c ) => c !== t ).map( ( c ) => c.footprint() );
	const colliders = [ ...garage.colliders, ...worldBounds, ...others ];

	if ( onFoot ) {

		const i = readHeroInput();
		// Qualquer comando de movimento interrompe a dança
		if ( hero.dancing && ( i.move.lengthSq() > 0 || i.turn || i.jump ) ) hero.stopDance();
		hero.update( dt, i, colliders );

	}
	else car.update( dt, busy ? IDLE_INPUT : readInput(), colliders );
	if ( ! onFoot ) hero.update( dt, { hands: steeringGrip() } ); // sentado, mãos no volante
	// Na câmera de cockpit a câmera fica dentro da cabeça dele: esconde o corpo
	hero.object.visible = onFoot || cameraMode !== 'cockpit';
	for ( const c of cars ) if ( c !== t ) c.update( dt, IDLE_INPUT );

	if ( garage.update( t ) ) toast( onFoot ? 'Portão reaberto: tem alguém embaixo' : 'Portão reaberto: carro embaixo do portão' );
	updateCamera( dt );

	sun.position.copy( t.position ).setY( 0 ).add( tmp.set( 10, 18, 8 ) );
	sun.target.position.copy( t.position ).setY( 0 );

	updateHUD();
	updateCarLabels();
	renderer.render( scene, camera );

}

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

// Acesso pelo console para depuração
window.app = {
	scene, camera, garage, controls, THREE, actions, cars, hero,
	get onFoot() {

		return onFoot;

	},
	get car() {

		return car;

	},
	render: () => renderer.render( scene, camera ),
	selectCar,
	setCameraMode,
	// Avança a simulação manualmente (útil quando a aba está em segundo plano)
	tick( seconds = 1 ) {

		for ( let t = 0; t < seconds; t += 1 / 60 ) frame( 1 / 60 );

	},
};
