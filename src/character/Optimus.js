import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { bakeToSkinnedMeshes } from '../utils/merge.js';

// O modelo mede ~101 unidades de comprimento como caminhão e ~137 de altura como robô.
const SCALE = 0.055;

const TRUCK = { maxSpeed: 24, maxReverse: 5, accel: 5, brake: 14, maxSteer: 0.55, halfWidth: 1.25, halfLength: 2.8 };
const ROBOT = { walk: 3.2, run: 8, accel: 10, turnRate: 4, radius: 1.3, stride: 4.2 };

const AXIS_X = new THREE.Vector3( 1, 0, 0 );
const AXIS_Y = new THREE.Vector3( 0, 1, 0 );
const AXIS_Z = new THREE.Vector3( 0, 0, 1 );

const draco = new DRACOLoader().setDecoderPath( './draco/' );
const loader = new GLTFLoader().setDRACOLoader( draco );

export class Optimus {

	constructor() {

		this.model = { id: 'optimus', name: 'Optimus Prime', url: './models/optimus/optimus.glb' };
		this.object = new THREE.Group();
		this.object.name = 'optimus';

		this.form = 'truck'; // 'truck' | 'robot' | 'transforming'
		this.terrain = null;
		this.velocityY = 0;
		this.speed = 0;
		this.steer = 0;
		this.wheelSpin = 0;

		this._phase = 0;
		this._time = 0;
		this._clipTime = 0;
		this._direction = 0;

	}

	get position() {

		return this.object.position;

	}

	get yaw() {

		return this.object.rotation.y;

	}

	get subtitle() {

		return { truck: 'caminhão', robot: 'robô', transforming: 'transformando…' }[ this.form ];

	}

	get transforming() {

		return this.form === 'transforming';

	}

	get height() {

		return THREE.MathUtils.lerp( 3.6, 7.4, this.duration ? this._clipTime / this.duration : 0 );

	}

	forward( target = new THREE.Vector3() ) {

		return target.set( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );

	}

	async load( onProgress ) {

		const gltf = await loader.loadAsync( this.model.url, ( e ) => e.total && onProgress?.( e.loaded / e.total ) );
		const scene = gltf.scene;

		this.mixer = new THREE.AnimationMixer( scene );
		this.action = this.mixer.clipAction( gltf.animations[ 0 ] );
		this.action.play();
		this.action.paused = true;
		this.duration = gltf.animations[ 0 ].duration;

		const find = ( name ) => {

			let found = null;
			scene.traverse( ( o ) => ! found && o.name.replace( /_\d+$/, '' ) === name && ( found = o ) );
			return found;

		};

		// Limites das duas formas, para apoiar no chão sem afundar.
		this.ground = {};
		for ( const [ form, t ] of [ [ 'robot', this.duration ], [ 'truck', 0 ] ] ) {

			this.setClipTime( t, scene );
			this.ground[ form ] = - new THREE.Box3().setFromObject( scene, true ).min.y;

		}

		this.setupWheels( scene );
		this.parts = bakeToSkinnedMeshes( scene );
		for ( const m of this.parts ) m.castShadow = m.receiveShadow = true;

		this.rig = new THREE.Group();
		this.rig.rotation.y = Math.PI; // o modelo olha para +Z; no jogo a frente é -Z
		this.rig.scale.setScalar( SCALE );
		this.rig.add( scene );
		this.body = new THREE.Group();
		this.body.add( this.rig );
		this.object.add( this.body );

		this.bones = {};
		for ( const name of [ 'Bip001 Pelvis', 'Bip001 Spine', 'Bip001 Spine1', 'Bip001 Head',
			'Bip001 L Thigh', 'Bip001 L Calf', 'Bip001 L Foot', 'Bip001 R Thigh', 'Bip001 R Calf', 'Bip001 R Foot',
			'Bip001 L UpperArm', 'Bip001 L Forearm', 'Bip001 R UpperArm', 'Bip001 R Forearm' ] ) {

			this.bones[ name.replace( 'Bip001 ', '' ).replace( ' ', '' ) ] = find( name.replace( / /g, '_' ) );

		}

		this.setClipTime( 0 );
		this.applyGround();

		return this;

	}

	setupWheels( scene ) {

		// As rodas (luntai = pneu) são nós animados próprios; giramos cada uma em torno do centro dela.
		this.wheels = [];
		const axle = new THREE.Vector3();
		scene.updateMatrixWorld( true );
		const sceneInverse = scene.matrixWorld.clone().invert();

		scene.traverse( ( node ) => {

			if ( ! /^lluntai\d+$/.test( node.name ) ) return;

			const box = new THREE.Box3();
			node.traverse( ( o ) => o.isMesh && box.expandByObject( o, true ) );
			if ( box.isEmpty() ) return;

			const center = node.worldToLocal( box.getCenter( new THREE.Vector3() ) );
			const inverse = node.getWorldQuaternion( new THREE.Quaternion() ).invert();
			axle.set( 1, 0, 0 ).transformDirection( scene.matrixWorld ).applyQuaternion( inverse ).normalize();
			const radius = box.applyMatrix4( sceneInverse ).getSize( new THREE.Vector3() ).y / 2;

			this.wheels.push( { node, center, axle: axle.clone(), radius, base: node.matrix.clone() } );

		} );

		this.wheelRadius = this.wheels.length ? this.wheels.reduce( ( a, w ) => a + w.radius, 0 ) / this.wheels.length * SCALE : 0.5;

	}

	setClipTime( t, root = this.rig ) {

		this._clipTime = t;
		this.action.time = t;
		this.mixer.update( 0 );
		root.updateMatrixWorld( true );

	}

	applyGround() {

		const k = this._clipTime / this.duration;
		this.rig.position.y = THREE.MathUtils.lerp( this.ground.truck, this.ground.robot, k ) * SCALE;

	}

	// Começa a transformação (caminhão → robô) ou a volta (robô → caminhão).
	transform() {

		if ( this.transforming || ! this.rig ) return false;

		this.target = this.form === 'truck' ? 'robot' : 'truck';
		this._direction = this.target === 'robot' ? 1 : - 1;
		this.form = 'transforming';
		this.speed = 0;
		this.steer = 0;
		this.body.position.y = 0;
		this.body.rotation.set( 0, 0, 0 );
		return true;

	}

	update( dt, input, colliders = [] ) {

		if ( ! this.rig ) return;
		this._time += dt;

		if ( this.transforming ) return this.updateTransform( dt );
		if ( this.form === 'truck' ) {

			this.drive( dt, input );
			this.move( dt, colliders );
			this.followGround( dt );
			this.spinWheels( dt );

		} else {

			this.walk( dt, input );
			this.move( dt, colliders );
			this.followGround( dt );
			this.animateWalk( dt );

		}

	}

	updateTransform( dt ) {

		const t = THREE.MathUtils.clamp( this._clipTime + dt * this._direction, 0, this.duration );
		this.setClipTime( t );
		this.applyGround();

		const done = this._direction > 0 ? t >= this.duration : t <= 0;
		if ( ! done ) return;

		this.form = this.target;
		if ( this.form === 'robot' ) this.captureRest();
		else for ( const w of this.wheels ) w.base.copy( w.node.matrix );
		this.onTransformEnd?.( this.form );

	}

	drive( dt, input ) {

		let accel = 0;
		let resist = 0.5 + this.speed * this.speed * 0.002;

		if ( input.handbrake ) resist += TRUCK.brake;
		else if ( input.throttle > 0 ) {

			if ( this.speed < - 0.3 ) resist += TRUCK.brake;
			else accel = TRUCK.accel * ( 1 - this.speed / TRUCK.maxSpeed );

		} else if ( input.brake > 0 ) {

			if ( this.speed > 0.3 ) resist += TRUCK.brake;
			else if ( this.speed > - TRUCK.maxReverse ) accel = - 3;

		}

		this.speed += accel * dt;
		const decel = resist * dt;
		this.speed = Math.abs( this.speed ) <= decel ? 0 : this.speed - Math.sign( this.speed ) * decel;

		this.steer += THREE.MathUtils.clamp( input.steer * TRUCK.maxSteer - this.steer, - 2 * dt, 2 * dt );
		const yawRate = this.speed * Math.tan( this.steer ) / ( TRUCK.halfLength * 1.3 );
		this.object.rotation.y += THREE.MathUtils.clamp( yawRate, - 1.2, 1.2 ) * dt;

	}

	walk( dt, input ) {

		const move = input.move;
		const amount = Math.min( 1, move.length() );
		const top = input.run ? ROBOT.run : ROBOT.walk;
		let target;

		if ( input.lockFacing ) {

			this.object.rotation.y += ( input.turn ?? 0 ) * 1.6 * dt;
			const along = this.forward().dot( move );
			target = along >= 0 ? along * top : along * ROBOT.walk * 0.6;

		} else {

			if ( amount > 0.01 ) {

				const yaw = Math.atan2( - move.x, - move.z );
				const d = Math.atan2( Math.sin( yaw - this.yaw ), Math.cos( yaw - this.yaw ) );
				this.object.rotation.y += THREE.MathUtils.clamp( d, - ROBOT.turnRate * dt, ROBOT.turnRate * dt );

			}

			const facing = amount > 0.01 ? Math.max( 0, this.forward().dot( move ) / amount ) : 0;
			target = amount * facing * top;

		}

		this.speed += THREE.MathUtils.clamp( target - this.speed, - ROBOT.accel * dt, ROBOT.accel * dt );

	}

	move( dt, colliders ) {

		const step = this.forward().multiplyScalar( this.speed * dt );
		if ( step.lengthSq() === 0 ) return;

		const pos = this.object.position;
		const was = this.collides( colliders );
		pos.add( step );
		if ( was || ! this.collides( colliders ) ) return;

		pos.sub( step );
		this.speed *= this.form === 'truck' ? - 0.2 : 0;

	}

	collides( colliders ) {

		const truck = this.form === 'truck';
		const halfWidth = truck ? TRUCK.halfWidth : ROBOT.radius;
		const halfLength = truck ? TRUCK.halfLength : ROBOT.radius;
		const s = Math.sin( this.yaw ), c = Math.cos( this.yaw );
		const p = new THREE.Vector2();

		for ( const [ x, z ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ - 1, 1 ], [ 1, 1 ], [ 0, - 1 ], [ 0, 1 ], [ - 1, 0 ], [ 1, 0 ] ] ) {

			const hx = x * halfWidth, hz = z * halfLength;
			p.set( this.position.x + hx * c + hz * s, this.position.z - hx * s + hz * c );
			for ( const box of colliders ) if ( box.containsPoint( p ) ) return true;

		}

		return false;

	}

	// Apoia no relevo; como caminhão também inclina a carroceria conforme a pista.
	followGround( dt ) {

		if ( ! this.terrain ) return;

		const t = this.terrain, p = this.object.position;
		const step = this.form === 'truck' ? 1.4 : 2;
		const ground = t.height( p.x, p.z, p.y, step );
		if ( ground === - Infinity ) return;

		if ( p.y > ground + 0.05 ) {

			this.velocityY -= 22 * dt;
			p.y = Math.max( ground, p.y + this.velocityY * dt );

		} else {

			this.velocityY = 0;
			p.y = ground;

		}

		let pitch = 0, roll = 0;
		if ( this.form === 'truck' ) {

			const s = Math.sin( this.yaw ), c = Math.cos( this.yaw );
			const at = ( x, z ) => {

				const h = t.height( p.x + x * c + z * s, p.z - x * s + z * c, p.y, step );
				return h === - Infinity || Math.abs( h - p.y ) > step ? p.y : h;

			};
			const a = TRUCK.halfLength * 0.8, w = TRUCK.halfWidth;
			pitch = THREE.MathUtils.clamp( Math.atan2( at( 0, - a ) - at( 0, a ), 2 * a ), - 0.5, 0.5 );
			roll = THREE.MathUtils.clamp( Math.atan2( at( w, 0 ) - at( - w, 0 ), 2 * w ), - 0.4, 0.4 );

		}

		const k = Math.min( 1, dt * 8 );
		this.body.rotation.x += ( pitch - this.body.rotation.x ) * k;
		this.body.rotation.z += ( roll - this.body.rotation.z ) * k;

	}

	spinWheels( dt ) {

		this.wheelSpin -= this.speed * dt / this.wheelRadius;
		const spin = new THREE.Matrix4();
		const toCenter = new THREE.Matrix4();
		const back = new THREE.Matrix4();

		for ( const w of this.wheels ) {

			toCenter.makeTranslation( w.center.x, w.center.y, w.center.z );
			back.makeTranslation( - w.center.x, - w.center.y, - w.center.z );
			spin.makeRotationAxis( w.axle, this.wheelSpin );
			w.node.matrix.copy( w.base ).multiply( toCenter ).multiply( spin ).multiply( back );
			w.node.matrix.decompose( w.node.position, w.node.quaternion, w.node.scale );

		}

	}

	captureRest() {

		this.rest = new Map();
		for ( const b of Object.values( this.bones ) ) if ( b ) this.rest.set( b, b.quaternion.clone() );

	}

	animateWalk( dt ) {

		const b = this.bones;
		for ( const [ bone, q ] of this.rest ) bone.quaternion.copy( q );

		const speed = Math.abs( this.speed );
		const gait = THREE.MathUtils.clamp( speed / ROBOT.walk, 0, 1 );
		const run = THREE.MathUtils.clamp( ( speed - ROBOT.walk ) / ( ROBOT.run - ROBOT.walk ), 0, 1 );
		this._phase += this.speed / THREE.MathUtils.lerp( ROBOT.stride, ROBOT.stride * 1.6, run ) * Math.PI * 2 * dt;
		const p = this._phase;

		const legSwing = gait * THREE.MathUtils.lerp( 0.4, 0.7, run );
		const kneeMax = gait * THREE.MathUtils.lerp( 0.6, 1.2, run );
		const armSwing = gait * THREE.MathUtils.lerp( 0.3, 0.7, run );
		const breathe = Math.sin( this._time * 1.6 ) * 0.015 * ( 1 - gait );

		this.rotate( b.Pelvis, AXIS_Y, - Math.sin( p ) * 0.1 * gait );
		this.rotate( b.Spine, AXIS_X, - run * 0.2 - breathe );
		this.rotate( b.Spine1, AXIS_Y, Math.sin( p ) * 0.14 * gait );

		for ( const [ side, sign ] of [ [ 'L', 1 ], [ 'R', - 1 ] ] ) {

			const s = Math.sin( p ) * sign;
			const c = Math.cos( p ) * sign;
			this.rotate( b[ `${ side }Thigh` ], AXIS_X, legSwing * s + run * 0.1 );
			this.rotate( b[ `${ side }Calf` ], AXIS_X, - kneeMax * Math.max( 0, c ) );
			this.rotate( b[ `${ side }Foot` ], AXIS_X, legSwing * 0.3 * Math.max( 0, - s ) );

			this.rotate( b[ `${ side }UpperArm` ], AXIS_X, - armSwing * s );
			this.rotate( b[ `${ side }UpperArm` ], AXIS_Z, sign * 0.06 * gait );
			this.rotate( b[ `${ side }Forearm` ], AXIS_X, 0.15 * gait + run * 0.6 );

		}

		this.body.position.y = - Math.abs( Math.sin( p ) ) * 0.12 * gait * ( 1 + run );

	}

	rotate( bone, axis, angle ) {

		if ( ! bone || ! angle ) return;

		// Gira o osso em torno de um eixo dado no espaço do personagem (X = direita, Y = cima, Z = trás).
		bone.parent.updateWorldMatrix( true, false );
		const parent = bone.parent.getWorldQuaternion( new THREE.Quaternion() );
		const root = this.object.getWorldQuaternion( new THREE.Quaternion() ).invert();
		const P = root.multiply( parent );
		const q = new THREE.Quaternion().setFromAxisAngle( axis, angle );
		bone.quaternion.premultiply( P ).premultiply( q ).premultiply( P.invert() );

	}

	eyePosition( target = new THREE.Vector3() ) {

		this.bones.Head.getWorldPosition( target );
		return target.addScaledVector( this.forward(), this.form === 'truck' ? 0.6 : 0.5 ).add( new THREE.Vector3( 0, 0.2, 0 ) );

	}

}
