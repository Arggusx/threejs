import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { animate, ease } from './tween.js';

// Geometria do modelo (unidades em metros, frente do carro apontando para -Z)
const WHEELBASE = 2.65;
const WHEEL_RADIUS = 0.36;
const MAX_STEER = 0.6;
const MAX_SPEED = 75; // m/s (~270 km/h)
const MAX_REVERSE = 8;
const MAX_AUTOPILOT_YAW_RATE = 1.2; // rad/s

// Região (no espaço do carro) que define cada porta. Os triângulos cujo centro
// cai dentro dela são recortados da carroceria e presos a uma dobradiça.
export const DOOR_REGION = { xMin: 0.6, zMin: - 0.72, zMax: 0.6, yMin: 0.3, yMax: 1.0 };
const DOOR_ANGLE = THREE.MathUtils.degToRad( 65 );

// Pontos do contorno do carro usados para colisão
const HULL = [];
for ( let i = 0; i <= 4; i ++ ) for ( let j = 0; j <= 8; j ++ ) {

	// só o perímetro: 5 pontos na largura × 9 no comprimento
	if ( i > 0 && i < 4 && j > 0 && j < 8 ) continue;
	HULL.push( new THREE.Vector2( - 0.98 + i * 0.49, - 2.25 + j * 0.5625 ) );

}

export const PAINT_FINISHES = {
	metalico: { metalness: 1, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0 },
	solido: { metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0 },
	fosco: { metalness: 0.45, roughness: 0.7, clearcoat: 0, clearcoatRoughness: 0.5, iridescence: 0 },
	perolado: { metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 1 },
	espelhado: { metalness: 1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.0, iridescence: 0 },
};

export const RIM_FINISHES = {
	prata: { color: 0xffffff, metalness: 1, roughness: 0.5 },
	cromado: { color: 0xffffff, metalness: 1, roughness: 0.06 },
	preto: { color: 0x1a1a1a, metalness: 0.6, roughness: 0.45 },
	dourado: { color: 0xd4a62a, metalness: 1, roughness: 0.28 },
	bronze: { color: 0x8a5a2b, metalness: 1, roughness: 0.35 },
};

export const GLASS_TINTS = {
	transparente: { color: 0xffffff, roughness: 0 },
	fume: { color: 0x555555, roughness: 0 },
	escuro: { color: 0x161616, roughness: 0.05 },
	azulado: { color: 0x8fc4ff, roughness: 0 },
};

export const SUSPENSION = { padrao: 0, rebaixada: - 0.04, elevada: 0.06 };

export class Car {

	constructor() {

		this.object = new THREE.Group(); // posição/rotação no mundo
		this.object.name = 'car';

		this.speed = 0; // m/s, positivo = para frente
		this.steer = 0;
		this.wheelSpin = 0;
		this.doors = { left: 0, right: 0 }; // 0 = fechada, 1 = aberta (valor animado)
		this.doorTargets = { left: false, right: false };
		this.headlightsOn = false;
		this.hazardsOn = false;
		this.braking = false;
		this.autopilot = null;
		this.rideHeight = 0;

		this._roll = 0;
		this._pitch = 0;
		this._prevSpeed = 0;
		this._time = 0;

		this.materials = {
			body: new THREE.MeshPhysicalMaterial( { color: 0xd40000, ...PAINT_FINISHES.metalico, iridescenceIOR: 1.8 } ),
			details: new THREE.MeshStandardMaterial( { color: 0xffffff, metalness: 1, roughness: 0.5 } ),
			rims: new THREE.MeshStandardMaterial( { ...RIM_FINISHES.prata } ),
			glass: new THREE.MeshPhysicalMaterial( { color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1 } ),
			caliper: new THREE.MeshStandardMaterial( { color: 0xffc400, metalness: 0.3, roughness: 0.35 } ),
			carbon: new THREE.MeshPhysicalMaterial( { color: 0x101010, metalness: 0.4, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 } ),
		};

	}

	async load( onProgress ) {

		const draco = new DRACOLoader();
		draco.setDecoderPath( './draco/' );

		const loader = new GLTFLoader();
		loader.setDRACOLoader( draco );

		const [ gltf, shadowMap ] = await Promise.all( [
			loader.loadAsync( './models/ferrari.glb', ( e ) => e.total && onProgress?.( e.loaded / e.total ) ),
			new THREE.TextureLoader().loadAsync( './models/ferrari_ao.png' ),
		] );

		const root = gltf.scene.children[ 0 ];
		this.root = root;
		this.object.add( root );

		// Tudo que não é roda vai para o "chassi", que pode inclinar e mudar de altura
		this.chassis = new THREE.Group();
		this.chassis.name = 'chassis';
		root.add( this.chassis );
		this.chassis.attach( root.getObjectByName( 'main' ) );
		this.chassis.attach( root.getObjectByName( 'steering_wheel' ) );

		this.applyMaterials();
		this.setupWheels();
		root.updateMatrixWorld( true );

		this.bounds = new THREE.Box3().setFromObject( root.getObjectByName( 'body' ) );
		this.setupDoors();
		this.setupLights();
		this.setupSpoilers();

		root.traverse( ( o ) => {

			if ( o.isMesh ) {

				o.castShadow = true;
				o.receiveShadow = true;

			}

		} );

		// Sombra de oclusão ambiente do exemplo original
		const shadow = new THREE.Mesh(
			new THREE.PlaneGeometry( 0.655 * 4, 1.3 * 4 ),
			new THREE.MeshBasicMaterial( { map: shadowMap, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true } )
		);
		shadow.rotation.x = - Math.PI / 2;
		shadow.position.y = 0.002;
		shadow.renderOrder = 2;
		root.add( shadow );

		return this;

	}

	applyMaterials() {

		const get = ( name ) => this.root.getObjectByName( name );
		const m = this.materials;

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

	setupWheels() {

		// Cada roda ganha um pivô para poder esterçar (Y) independentemente do giro (X)
		this.wheels = [];
		this.frontPivots = [];

		for ( const id of [ 'fl', 'fr', 'rl', 'rr' ] ) {

			const wheel = this.root.getObjectByName( `wheel_${ id }` );
			const pivot = new THREE.Group();
			pivot.position.copy( wheel.position );
			this.root.add( pivot );
			pivot.add( wheel );
			wheel.position.set( 0, 0, 0 );

			this.wheels.push( wheel );
			if ( id[ 0 ] === 'f' ) this.frontPivots.push( pivot );

			// Pinça de freio: um arco preso ao pivô (esterça com a roda, mas não gira)
			const caliper = new THREE.Mesh( new THREE.TorusGeometry( 0.19, 0.038, 8, 16, 1 ), this.materials.caliper );
			caliper.rotation.set( 0, Math.PI / 2, 0 );
			caliper.rotateZ( THREE.MathUtils.degToRad( 121 ) );
			caliper.scale.z = 0.9;
			caliper.position.x = ( id[ 1 ] === 'l' ? - 1 : 1 ) * 0.045;
			pivot.add( caliper );

		}

		this.steeringWheel = this.root.getObjectByName( 'steering_wheel' );
		this.steeringBase = this.steeringWheel.quaternion.clone();

	}

	// ---------------------------------------------------------------- portas

	setupDoors() {

		const main = this.root.getObjectByName( 'main' );
		const rootInv = this.root.matrixWorld.clone().invert();
		const r = DOOR_REGION;

		this.doorPivots = {};

		for ( const [ side, sign ] of [ [ 'left', - 1 ], [ 'right', 1 ] ] ) {

			const hinge = new THREE.Vector3( sign * 0.92, 0, r.zMin );
			const pivot = new THREE.Group();
			pivot.name = `door_${ side }`;
			pivot.position.copy( hinge );
			this.chassis.add( pivot );
			this.doorPivots[ side ] = pivot;

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

	isDoorOpen( side ) {

		return this.doorTargets[ side ];

	}

	setDoor( side, open ) {

		this.doorTargets[ side ] = open;
		const from = this.doors[ side ];
		const to = open ? 1 : 0;
		const sign = side === 'left' ? - 1 : 1;
		const pivot = this.doorPivots[ side ];

		return animate( {
			key: `door-${ side }`, from, to,
			duration: 1.1 * Math.abs( to - from ),
			easing: open ? ease.out : ease.inOut,
			onUpdate: ( v ) => {

				this.doors[ side ] = v;
				pivot.rotation.y = sign * DOOR_ANGLE * v;
				pivot.rotation.z = sign * 0.08 * v; // leve elevação, como numa porta real

			},
		} );

	}

	toggleDoor( side ) {

		return this.setDoor( side, ! this.isDoorOpen( side ) );

	}

	closeDoors() {

		return Promise.all( [ this.setDoor( 'left', false ), this.setDoor( 'right', false ) ] );

	}

	// ---------------------------------------------------------------- luzes

	setupLights() {

		const b = this.bounds;
		this.headlights = [];

		for ( const sign of [ - 1, 1 ] ) {

			const light = new THREE.SpotLight( 0xfff4e0, 0, 40, THREE.MathUtils.degToRad( 26 ), 0.45, 1.2 );
			light.position.set( sign * 0.62, 0.62, b.min.z + 0.35 );
			light.target.position.set( sign * 0.9, 0, b.min.z - 14 );
			light.castShadow = false;
			this.chassis.add( light, light.target );
			this.headlights.push( light );

		}

		this.reverseLight = new THREE.PointLight( 0xffffff, 0, 5, 2 );
		this.reverseLight.position.set( 0, 0.6, b.max.z + 0.4 );
		this.chassis.add( this.reverseLight );

		this.setHeadlights( false );

	}

	setHeadlights( on ) {

		this.headlightsOn = on;
		const m = this.materials;

		m.headlights.emissive.set( 0xfff6e8 );
		m.leds.emissive.set( 0xffffff );

		animate( {
			key: 'headlights', from: on ? 0 : 1, to: on ? 1 : 0, duration: 0.25,
			onUpdate: ( v ) => {

				for ( const l of this.headlights ) l.intensity = v * 60;
				m.headlights.emissiveIntensity = v * 3;

			},
		} );

	}

	setHazards( on ) {

		this.hazardsOn = on;

	}

	// ---------------------------------------------------------------- peças

	setupSpoilers() {

		const b = this.bounds;
		const body = this.root.getObjectByName( 'body' );

		// Descobre a altura da tampa traseira com um raio vindo de cima
		const deckZ = b.max.z - 0.38;
		const ray = new THREE.Raycaster( new THREE.Vector3( 0, 5, deckZ ), new THREE.Vector3( 0, - 1, 0 ) );
		const hit = ray.intersectObject( body, false )[ 0 ];
		const deckY = hit ? hit.point.y : b.max.y - 0.25;

		const carbon = this.materials.carbon;
		this.spoilers = {};

		// Asa GT: perfil + suportes + placas laterais
		const wing = new THREE.Group();
		const profile = new THREE.Shape();
		profile.moveTo( 0, 0 );
		profile.bezierCurveTo( 0.08, 0.05, 0.22, 0.045, 0.32, 0.0 );
		profile.bezierCurveTo( 0.22, 0.015, 0.08, 0.012, 0, 0 );
		const blade = new THREE.Mesh( new THREE.ExtrudeGeometry( profile, { depth: 1.7, bevelEnabled: false } ), carbon );
		blade.rotation.y = Math.PI / 2;
		blade.position.set( - 0.85, 0.3, - 0.12 );
		blade.rotation.x = - 0.12;
		wing.add( blade );

		for ( const sign of [ - 1, 1 ] ) {

			const strut = new THREE.Mesh( new THREE.BoxGeometry( 0.025, 0.32, 0.12 ), carbon );
			strut.position.set( sign * 0.45, 0.15, 0.02 );
			strut.rotation.x = - 0.2;
			const plate = new THREE.Mesh( new THREE.BoxGeometry( 0.012, 0.16, 0.42 ), carbon );
			plate.position.set( sign * 0.86, 0.3, 0.03 );
			wing.add( strut, plate );

		}

		wing.position.set( 0, deckY, deckZ );
		this.spoilers.gt = wing;

		// Lip spoiler discreto na borda da tampa
		const lip = new THREE.Mesh( new THREE.BoxGeometry( 1.35, 0.025, 0.14 ), carbon );
		lip.position.set( 0, deckY + 0.04, b.max.z - 0.22 );
		lip.rotation.x = 0.25;
		this.spoilers.lip = lip;

		for ( const s of Object.values( this.spoilers ) ) {

			s.visible = false;
			s.traverse( ( o ) => o.isMesh && ( o.castShadow = true ) );
			this.chassis.add( s );

		}

	}

	setSpoiler( type ) {

		for ( const [ name, obj ] of Object.entries( this.spoilers ) ) {

			if ( name === type && ! obj.visible ) {

				obj.visible = true;
				animate( { key: `spoiler-${ name }`, from: 0.01, to: 1, duration: 0.6, easing: ease.outBack, onUpdate: ( v ) => obj.scale.setScalar( v ) } );

			} else if ( name !== type ) {

				obj.visible = false;

			}

		}

	}

	setPaint( color ) {

		const target = new THREE.Color( color );
		const start = this.materials.body.color.clone();
		animate( { key: 'paint', duration: 0.6, onUpdate: ( v ) => this.materials.body.color.lerpColors( start, target, v ) } );

	}

	setPaintFinish( name ) {

		Object.assign( this.materials.body, PAINT_FINISHES[ name ] );

	}

	setRims( name ) {

		const f = RIM_FINISHES[ name ];
		this.materials.rims.color.set( f.color );
		this.materials.rims.metalness = f.metalness;
		this.materials.rims.roughness = f.roughness;

	}

	setCalipers( color ) {

		this.materials.caliper.color.set( color );

	}

	setGlass( name ) {

		const t = GLASS_TINTS[ name ];
		this.materials.glass.color.set( t.color );
		this.materials.glass.roughness = t.roughness;

	}

	setInterior( color ) {

		this.materials.leather.color.set( color );

	}

	setSuspension( name ) {

		animate( { key: 'suspension', from: this.rideHeight, to: SUSPENSION[ name ], duration: 0.8, easing: ease.outBack, onUpdate: ( v ) => ( this.rideHeight = v ) } );

	}

	// ---------------------------------------------------------------- direção

	get position() {

		return this.object.position;

	}

	get yaw() {

		return this.object.rotation.y;

	}

	forward( target = new THREE.Vector3() ) {

		return target.set( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );

	}

	update( dt, input, colliders = [] ) {

		if ( ! this.root ) return;

		this._time += dt;

		if ( this.autopilot ) {

			this.updateAutopilot( dt );

		} else {

			this.updateDriving( dt, input );
			this.move( dt, colliders );

		}

		this.updateVisuals( dt );

	}

	updateDriving( dt, input ) {

		const doorsOpen = this.doors.left > 0.05 || this.doors.right > 0.05;
		let drive = 0; // aceleração do motor (com sinal)
		let resist = 0.6 + this.speed * this.speed * 0.0012; // rolagem + arrasto (sempre contra o movimento)
		this.braking = false;

		if ( input.handbrake ) {

			resist += 16;
			this.braking = true;

		} else if ( input.throttle > 0 ) {

			// Acelerar enquanto anda de ré primeiro freia
			if ( this.speed < - 0.3 ) resist += 14;
			else if ( ! doorsOpen ) drive = 9 * ( 1 - this.speed / MAX_SPEED );

		} else if ( input.brake > 0 ) {

			if ( this.speed > 0.3 ) {

				resist += 14;
				this.braking = true;

			} else if ( ! doorsOpen && this.speed > - MAX_REVERSE ) {

				drive = - 4.5;

			}

		}

		this.speed += drive * dt;

		// A resistência pode parar o carro, mas nunca empurrá-lo no sentido contrário
		const decel = resist * dt;
		this.speed = Math.abs( this.speed ) <= decel ? 0 : this.speed - Math.sign( this.speed ) * decel;

		// Limita o esterço para que a aceleração lateral não passe de ~1.2 g
		const steerLimit = Math.min( MAX_STEER, Math.atan( 12 * WHEELBASE / Math.max( this.speed * this.speed, 1e-3 ) ) );
		const target = input.steer * steerLimit;
		this.steer += THREE.MathUtils.clamp( target - this.steer, - 2.5 * dt, 2.5 * dt );

	}

	move( dt, colliders ) {

		const pos = this.object.position;
		const dir = new THREE.Vector3();

		// Subpassos de no máximo 10 cm para não atravessar paredes finas em alta velocidade
		const steps = Math.max( 1, Math.ceil( Math.abs( this.speed * dt ) / 0.1 ) );
		const h = dt / steps;

		for ( let i = 0; i < steps; i ++ ) {

			const prevX = pos.x, prevZ = pos.z, prevYaw = this.object.rotation.y;
			// Se já estava sobrepondo algo (ex.: portão fechou em cima do carro), deixa sair
			const wasColliding = this.collides( colliders );

			this.object.rotation.y += ( this.speed * Math.tan( this.steer ) / WHEELBASE ) * h;
			pos.addScaledVector( this.forward( dir ), this.speed * h );

			if ( ! wasColliding && this.collides( colliders ) ) {

				pos.x = prevX;
				pos.z = prevZ;
				this.object.rotation.y = prevYaw;
				this.speed *= - 0.25;
				break;

			}

		}

	}

	collides( colliders ) {

		if ( ! colliders.length ) return false;

		const s = Math.sin( this.yaw ), c = Math.cos( this.yaw );
		const p = new THREE.Vector2();

		for ( const h of HULL ) {

			p.set( this.position.x + h.x * c + h.y * s, this.position.z - h.x * s + h.y * c );
			for ( const box of colliders ) if ( box.containsPoint( p ) ) return true;

		}

		return false;

	}

	// Segue uma curva (CurvePath/Curve3) com velocidade suave. Retorna uma Promise.
	followPath( curve, { maxSpeed = 5, reverse = false } = {} ) {

		const length = curve.getLength();
		if ( ! ( length > 0.05 ) ) return Promise.resolve();

		return new Promise( ( resolve ) => {

			this.autopilot = { curve, length, s: 0, maxSpeed, reverse, resolve };

		} );

	}

	updateAutopilot( dt ) {

		const ap = this.autopilot;
		const a = 2.2;
		const remaining = ap.length - ap.s;

		// Em curvas fechadas reduz a velocidade para o carro não girar rápido demais
		const u0 = ap.s / ap.length;
		const ahead = Math.min( 0.3, remaining );
		const bend = ahead > 1e-3 ? ap.curve.getTangentAt( u0 ).angleTo( ap.curve.getTangentAt( ( ap.s + ahead ) / ap.length ) ) / ahead : 0;
		const curveLimit = Math.max( 0.15, MAX_AUTOPILOT_YAW_RATE / Math.max( bend, 1e-3 ) );

		const v = Math.min( ap.maxSpeed, curveLimit, Math.sqrt( 2 * a * ( ap.s + 0.05 ) ), Math.sqrt( 2 * a * Math.max( remaining, 0 ) ) + 0.05 );

		ap.s = Math.min( ap.s + v * dt, ap.length );
		const u = ap.s / ap.length;

		const point = ap.curve.getPointAt( u );
		const tangent = ap.curve.getTangentAt( u );
		if ( ap.reverse ) tangent.negate();

		const prevYaw = this.object.rotation.y;
		const yaw = Math.atan2( - tangent.x, - tangent.z );
		const dYaw = Math.atan2( Math.sin( yaw - prevYaw ), Math.cos( yaw - prevYaw ) );

		this.object.position.set( point.x, 0, point.z );
		this.object.rotation.y = prevYaw + dYaw;
		this.speed = ap.reverse ? - v : v;
		this.braking = remaining < 1.5;

		if ( v > 0.2 && dt > 0 ) {

			const targetSteer = THREE.MathUtils.clamp( Math.atan( ( dYaw / dt ) * WHEELBASE / this.speed ), - MAX_STEER, MAX_STEER );
			this.steer += ( targetSteer - this.steer ) * Math.min( 1, dt * 8 );

		}

		if ( ap.s >= ap.length - 1e-4 ) {

			this.speed = 0;
			this.braking = false;
			this.autopilot = null;
			ap.resolve();

		}

	}

	updateVisuals( dt ) {

		// Giro das rodas
		this.wheelSpin -= this.speed * dt / WHEEL_RADIUS;
		for ( const w of this.wheels ) w.rotation.x = this.wheelSpin;
		for ( const p of this.frontPivots ) p.rotation.y = this.steer;

		// Volante (relação ~1:5). O eixo Y local da coluna aponta para a frente do carro,
		// por isso o sinal negativo: esterço à esquerda gira o volante no sentido anti-horário.
		const turn = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), - this.steer * 5 );
		this.steeringWheel.quaternion.copy( this.steeringBase ).multiply( turn );

		// Inclinação da carroceria por aceleração lateral/longitudinal
		const longAccel = dt > 0 ? ( this.speed - this._prevSpeed ) / dt : 0;
		const latAccel = this.speed * this.speed * Math.tan( this.steer ) / WHEELBASE;
		this._prevSpeed = this.speed;

		const k = Math.min( 1, dt * 5 );
		this._roll += ( THREE.MathUtils.clamp( latAccel * 0.0035, - 0.045, 0.045 ) - this._roll ) * k;
		this._pitch += ( THREE.MathUtils.clamp( - longAccel * 0.0025, - 0.03, 0.03 ) - this._pitch ) * k;
		this.chassis.rotation.set( this._pitch, 0, this._roll );
		this.chassis.position.y = this.rideHeight;

		// Lanternas: acesas com farol, mais fortes ao frear
		const m = this.materials;
		m.taillights.emissive.set( 0xff1010 );
		m.taillights.emissiveIntensity = this.braking ? 4 : this.headlightsOn ? 1.2 : 0;
		this.reverseLight.intensity = this.speed < - 0.1 ? 4 : 0;

		// Pisca-alerta
		const blink = this.hazardsOn && Math.floor( this._time * 2.5 ) % 2 === 0;
		m.leds.emissive.set( blink ? 0xff8a00 : 0xffffff );
		m.leds.emissiveIntensity = blink ? 6 : this.headlightsOn ? 2 : 0;

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
