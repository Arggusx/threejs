import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { animate, ease } from '../utils/tween.js';
import { mergeStaticMeshes } from '../utils/merge.js';

const MAX_STEER = 0.6;
const MAX_SPEED = 75;
const MAX_REVERSE = 8;
const MAX_LATERAL_ACCEL = 14;
const MAX_AUTOPILOT_YAW_RATE = 1.2;
const DOOR_ANGLE = THREE.MathUtils.degToRad( 65 );
const GROUND_STEP = 1.2;
const DETAIL_RADIUS = 0.4;
const DETAIL_DISTANCE = 60;
const GRAVITY = 22;

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

export const DEFAULT_SETTINGS = {
	paint: '#d40000', finish: 'metalico', rims: 'prata', calipers: '#ffc400',
	spoiler: 'none', glass: 'transparente', interior: '#ffffff', suspension: 'padrao',
};

const draco = new DRACOLoader().setDecoderPath( './draco/' );
const loader = new GLTFLoader().setDRACOLoader( draco );
const shadowTexture = new THREE.TextureLoader().loadAsync( './textures/car_shadow_ao.png' );

export class Car {

	constructor( model ) {

		this.model = model;
		this.settings = { ...DEFAULT_SETTINGS, ...model.defaults };

		this.object = new THREE.Group();
		this.object.name = model.id;

		this.speed = 0;
		this.steer = 0;
		this.wheelSpin = 0;
		this.doors = { left: 0, right: 0 };
		this.doorTargets = { left: false, right: false };
		this.headlightsOn = false;
		this.hazardsOn = false;
		this.braking = false;
		this.autopilot = null;
		this.rideHeight = 0;
		this.velocityY = 0;
		this.terrain = null;

		this._roll = 0;
		this._pitch = 0;
		this._prevSpeed = 0;
		this._time = 0;

		const w = model.halfWidth, l = model.halfLength;
		this.hull = [];
		for ( let i = 0; i <= 4; i ++ ) for ( let j = 0; j <= 8; j ++ ) {

			if ( i > 0 && i < 4 && j > 0 && j < 8 ) continue;
			this.hull.push( new THREE.Vector2( - w + i * w / 2, - l + j * l / 4 ) );

		}

		this.materials = {
			body: new THREE.MeshPhysicalMaterial( { color: this.settings.paint, ...PAINT_FINISHES.metalico, iridescenceIOR: 1.8 } ),
			details: new THREE.MeshStandardMaterial( { color: 0xffffff, metalness: 1, roughness: 0.5 } ),
			rims: new THREE.MeshStandardMaterial( { ...RIM_FINISHES.prata } ),
			glass: new THREE.MeshPhysicalMaterial( { color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1 } ),
			caliper: new THREE.MeshStandardMaterial( { color: 0xffc400, metalness: 0.3, roughness: 0.35 } ),
			carbon: new THREE.MeshPhysicalMaterial( { color: 0x101010, metalness: 0.4, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 } ),
		};

	}

	get name() {

		return this.model.name;

	}

	async load( onProgress ) {

		const [ gltf, shadowMap ] = await Promise.all( [
			loader.loadAsync( this.model.url, ( e ) => e.total && onProgress?.( e.loaded / e.total ) ),
			shadowTexture,
		] );

		// Monta o modelo com o carro na origem: os pivôs das rodas/portas são calculados em espaço
		// local e sairiam deslocados se o carro já estivesse posicionado no mundo.
		const placement = { position: this.object.position.clone(), yaw: this.object.rotation.y };
		this.object.position.set( 0, 0, 0 );
		this.object.rotation.y = 0;
		this.object.updateMatrixWorld( true );

		this.model.build( this, gltf );
		this.interiorBase = this.materials.leather.color.clone();

		this.setupLights();
		if ( this.model.spoilers ) this.setupSpoilers();

		this.root.updateMatrixWorld( true );
		const extent = new THREE.Vector3();
		this.root.traverse( ( o ) => {

			if ( o.isMesh ) {

				o.castShadow = new THREE.Box3().setFromObject( o ).getSize( extent ).length() > 0.6;
				o.receiveShadow = true;

			}

		} );

		// Junta as peças que andam juntas e têm o mesmo material: centenas de malhas viram poucas dezenas.
		mergeStaticMeshes( this.root, [
			this.chassis, this.steeringWheel, ...this.wheels, ...this.frontPivots,
			...Object.values( this.doorPivots ), ...Object.values( this.spoilers ?? {} ),
			...( this.model.movingParts?.( this ) ?? [] ),
		] );

		const shadow = new THREE.Mesh(
			new THREE.PlaneGeometry( ...this.model.shadowSize ),
			new THREE.MeshBasicMaterial( { map: shadowMap, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true } )
		);
		shadow.rotation.x = - Math.PI / 2;
		shadow.position.y = 0.002;
		shadow.renderOrder = 2;
		this.root.add( shadow );

		const size = this.bounds.getSize( new THREE.Vector3() );
		this.hitBox = new THREE.Mesh( new THREE.BoxGeometry( size.x, size.y, size.z ), new THREE.MeshBasicMaterial( { visible: false } ) );
		this.bounds.getCenter( this.hitBox.position );
		this.hitBox.userData.car = this;
		this.chassis.add( this.hitBox );

		// Grupo entre o carro e o modelo que inclina conforme o relevo (subida/descida e lateral).
		this.tilt = new THREE.Group();
		this.object.add( this.tilt );
		this.tilt.add( this.root );

		// Peças pequenas (parafusos, interior, emblemas...) só aparecem de perto: de longe não fazem
		// diferença na tela e custam boa parte dos triângulos do carro. Rodas ficam sempre.
		this.details = [];
		const wheelParts = new Set();
		for ( const w of [ ...this.wheels, ...this.frontPivots ] ) w.traverse( ( o ) => wheelParts.add( o ) );
		const scale = new THREE.Vector3();
		this.root.traverse( ( o ) => {

			if ( ! o.isMesh || ! o.visible || wheelParts.has( o ) || o === shadow ) return;
			if ( ! o.geometry.boundingSphere ) o.geometry.computeBoundingSphere();
			if ( o.geometry.boundingSphere.radius * o.getWorldScale( scale ).x < DETAIL_RADIUS ) this.details.push( o );

		} );
		this.detailed = true;

		this.object.position.copy( placement.position );
		this.object.rotation.y = placement.yaw;

		return this;

	}

	key( name ) {

		return `${ this.model.id }-${ name }`;

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
			key: this.key( `door-${ side }` ), from, to,
			duration: 1.1 * Math.abs( to - from ),
			easing: open ? ease.out : ease.inOut,
			onUpdate: ( v ) => {

				this.doors[ side ] = v;
				if ( this.model.updateDoor ) {

					this.model.updateDoor( this, side, v );

				} else {

					pivot.rotation.y = sign * DOOR_ANGLE * v;
					pivot.rotation.z = sign * 0.08 * v; // leve elevação, como numa porta real

				}

			},
		} );

	}

	toggleDoor( side ) {

		return this.setDoor( side, ! this.isDoorOpen( side ) );

	}

	closeDoors() {

		return Promise.all( [ this.setDoor( 'left', false ), this.setDoor( 'right', false ) ] );

	}

	setupLights() {

		const b = this.bounds;
		const h = this.model.headlight;
		this.headlights = [];

		for ( const sign of [ - 1, 1 ] ) {

			const light = new THREE.SpotLight( 0xfff4e0, 0, 40, THREE.MathUtils.degToRad( 26 ), 0.45, 1.2 );
			light.position.set( sign * h.x, h.y, b.min.z + h.inset );
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
			key: this.key( 'headlights' ), from: on ? 0 : 1, to: on ? 1 : 0, duration: 0.25,
			onUpdate: ( v ) => {

				for ( const l of this.headlights ) {

					l.intensity = v * 60;
					l.visible = v > 0;

				}
				m.headlights.emissiveIntensity = v * 3;

			},
		} );

	}

	setHazards( on ) {

		this.hazardsOn = on;

	}

	setupSpoilers() {

		const b = this.bounds;

		const deckZ = b.max.z - 0.38;
		const ray = new THREE.Raycaster( new THREE.Vector3( 0, 5, deckZ ), new THREE.Vector3( 0, - 1, 0 ) );
		const hit = ray.intersectObject( this.bodyMesh, false )[ 0 ];
		const deckY = hit ? hit.point.y : b.max.y - 0.25;

		const carbon = this.materials.carbon;
		this.spoilers = {};

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

		if ( ! this.spoilers ) return;

		for ( const [ name, obj ] of Object.entries( this.spoilers ) ) {

			if ( name === type && ! obj.visible ) {

				obj.visible = true;
				animate( { key: this.key( `spoiler-${ name }` ), from: 0.01, to: 1, duration: 0.6, easing: ease.outBack, onUpdate: ( v ) => obj.scale.setScalar( v ) } );

			} else if ( name !== type ) {

				obj.visible = false;

			}

		}

	}

	setPaint( color ) {

		const target = new THREE.Color( color );
		const start = this.materials.body.color.clone();
		animate( { key: this.key( 'paint' ), duration: 0.6, onUpdate: ( v ) => this.materials.body.color.lerpColors( start, target, v ) } );

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

	setGlassQuality( refractive ) {

		const glass = this.materials.glass;
		glass.transmission = refractive ? 1 : 0;
		glass.transparent = ! refractive;
		glass.opacity = refractive ? 1 : 0.3;
		glass.depthWrite = refractive;
		glass.needsUpdate = true;

	}

	setInterior( color ) {

		const c = new THREE.Color( color );
		this.materials.leather.color.copy( c.equals( new THREE.Color( 0xffffff ) ) ? this.interiorBase : c.multiplyScalar( this.model.interiorTint ) );

	}

	setSuspension( name ) {

		animate( { key: this.key( 'suspension' ), from: this.rideHeight, to: SUSPENSION[ name ], duration: 0.8, easing: ease.outBack, onUpdate: ( v ) => ( this.rideHeight = v ) } );

	}

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

		this.followGround( dt );
		this.updateVisuals( dt );

	}

	updateDriving( dt, input ) {

		const doorsOpen = this.doors.left > 0.05 || this.doors.right > 0.05;
		let drive = 0;
		let resist = 0.6 + this.speed * this.speed * 0.0012;
		this.braking = false;

		if ( input.handbrake ) {

			resist += 16;
			this.braking = true;

		} else if ( input.throttle > 0 ) {

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

		const wanted = Math.abs( this.speed * Math.tan( this.steer ) / this.model.wheelbase );
		const excess = wanted > 0 ? 1 - Math.abs( this.yawRate() ) / wanted : 0;
		resist += excess * 6;

		this.speed += drive * dt;

		const decel = resist * dt;
		this.speed = Math.abs( this.speed ) <= decel ? 0 : this.speed - Math.sign( this.speed ) * decel;

		const target = input.steer * MAX_STEER;
		this.steer += THREE.MathUtils.clamp( target - this.steer, - 2.5 * dt, 2.5 * dt );

	}

	yawRate() {

		const rate = this.speed * Math.tan( this.steer ) / this.model.wheelbase;
		const limit = MAX_LATERAL_ACCEL / Math.max( Math.abs( this.speed ), 1e-3 );
		return THREE.MathUtils.clamp( rate, - limit, limit );

	}

	move( dt, colliders ) {

		const pos = this.object.position;
		const dir = new THREE.Vector3();

		const steps = Math.max( 1, Math.ceil( Math.abs( this.speed * dt ) / 0.1 ) );
		const h = dt / steps;

		for ( let i = 0; i < steps; i ++ ) {

			const prevX = pos.x, prevZ = pos.z, prevYaw = this.object.rotation.y;
			const wasColliding = this.collides( colliders );

			this.object.rotation.y += this.yawRate() * h;
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

		for ( const h of this.hull ) {

			p.set( this.position.x + h.x * c + h.y * s, this.position.z - h.x * s + h.y * c );
			for ( const box of colliders ) if ( box.containsPoint( p ) ) return true;

		}

		return false;

	}

	footprint( target = new THREE.Box2() ) {

		const s = Math.abs( Math.sin( this.yaw ) ), c = Math.abs( Math.cos( this.yaw ) );
		const w = this.model.halfWidth, l = this.model.halfLength;
		const half = new THREE.Vector2( w * c + l * s, w * s + l * c );
		const center = new THREE.Vector2( this.position.x, this.position.z );
		return target.set( center.clone().sub( half ), center.add( half ) );

	}

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

		this.object.position.set( point.x, this.object.position.y, point.z );
		this.object.rotation.y = prevYaw + dYaw;
		this.speed = ap.reverse ? - v : v;
		this.braking = remaining < 1.5;

		if ( v > 0.2 && dt > 0 ) {

			const targetSteer = THREE.MathUtils.clamp( Math.atan( ( dYaw / dt ) * this.model.wheelbase / this.speed ), - MAX_STEER, MAX_STEER );
			this.steer += ( targetSteer - this.steer ) * Math.min( 1, dt * 8 );

		}

		if ( ap.s >= ap.length - 1e-4 ) {

			this.speed = 0;
			this.braking = false;
			this.autopilot = null;
			ap.resolve();

		}

	}

	updateDetail( cameraPosition ) {

		const near = this.object.position.distanceToSquared( cameraPosition ) < DETAIL_DISTANCE * DETAIL_DISTANCE;
		if ( near === this.detailed ) return;
		this.detailed = near;
		for ( const m of this.details ) m.visible = near;

	}

	// Apoia o carro no terreno: altura pelo centro e inclinação pelas quatro "rodas".
	followGround( dt ) {

		if ( ! this.terrain ) return;

		const t = this.terrain, p = this.object.position;
		const ground = t.height( p.x, p.z, p.y, GROUND_STEP );
		if ( ground === - Infinity ) return;
		// O piloto automático não desvia de beiradas: nesse caso o carro mantém a altura.
		if ( this.autopilot && ground < p.y - 1.5 ) return;

		if ( p.y > ground + 0.05 ) {

			this.velocityY -= GRAVITY * dt;
			p.y = Math.max( ground, p.y + this.velocityY * dt );

		} else {

			this.velocityY = 0;
			p.y = ground;

		}

		const a = this.model.wheelbase / 2, w = this.model.halfWidth;
		const s = Math.sin( this.yaw ), c = Math.cos( this.yaw );
		const at = ( x, z ) => {

			// Amostras que caem fora do chão (beirada, borda elevada) não inclinam o carro.
			const h = t.height( p.x + x * c + z * s, p.z - x * s + z * c, p.y, GROUND_STEP );
			return h === - Infinity || Math.abs( h - p.y ) > GROUND_STEP ? p.y : h;

		};

		const pitch = THREE.MathUtils.clamp( Math.atan2( at( 0, - a ) - at( 0, a ), 2 * a ), - 0.5, 0.5 );
		const roll = THREE.MathUtils.clamp( Math.atan2( at( w, 0 ) - at( - w, 0 ), 2 * w ), - 0.4, 0.4 );
		const k = Math.min( 1, dt * 10 );
		this.tilt.rotation.x += ( pitch - this.tilt.rotation.x ) * k;
		this.tilt.rotation.z += ( roll - this.tilt.rotation.z ) * k;

	}

	updateVisuals( dt ) {

		this.wheelSpin -= this.speed * dt / this.model.wheelRadius;
		for ( const w of this.wheels ) w.rotation.x = this.wheelSpin;
		for ( const p of this.frontPivots ) p.rotation.y = this.steer;

		const turn = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), - this.steer * 5 );
		this.steeringWheel.quaternion.copy( this.steeringBase ).multiply( turn );

		const longAccel = dt > 0 ? ( this.speed - this._prevSpeed ) / dt : 0;
		const latAccel = this.speed * this.yawRate();
		this._prevSpeed = this.speed;

		const k = Math.min( 1, dt * 5 );
		this._roll += ( THREE.MathUtils.clamp( latAccel * 0.0035, - 0.045, 0.045 ) - this._roll ) * k;
		this._pitch += ( THREE.MathUtils.clamp( longAccel * 0.0025, - 0.03, 0.03 ) - this._pitch ) * k;
		this.chassis.rotation.set( this._pitch, 0, this._roll );
		this.chassis.position.y = this.rideHeight;

		const m = this.materials;
		m.taillights.emissive.set( 0xff1010 );
		m.taillights.emissiveIntensity = this.braking ? 4 : this.headlightsOn ? 1.2 : 0;
		this.reverseLight.intensity = this.speed < - 0.1 ? 4 : 0;
		this.reverseLight.visible = this.reverseLight.intensity > 0;

		const blink = this.hazardsOn && Math.floor( this._time * 2.5 ) % 2 === 0;
		m.leds.emissive.set( blink ? 0xff8a00 : 0xffffff );
		m.leds.emissiveIntensity = blink ? 6 : this.headlightsOn ? 2 : 0;
		if ( m.rearLeds ) {

			m.rearLeds.emissive.set( 0xff8a00 );
			m.rearLeds.emissiveIntensity = blink ? 6 : 0;

		}

	}

}
