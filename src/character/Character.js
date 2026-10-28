import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const WALK_SPEED = 1.8;
const RUN_SPEED = 7;
const ACCEL = 14;
const TURN_RATE = 12;
const GRAVITY = 22;
const JUMP_SPEED = 7.5;
const RADIUS = 0.3;
const STEP = 0.6;
const GRIP_SIGN = 1;

const AXIS_X = new THREE.Vector3( 1, 0, 0 );
const AXIS_Y = new THREE.Vector3( 0, 1, 0 );
const AXIS_Z = new THREE.Vector3( 0, 0, 1 );

const loader = new GLTFLoader().setDRACOLoader( new DRACOLoader().setDecoderPath( './draco/' ) );

export class Character {

	constructor( model ) {

		this.model = model;
		this.object = new THREE.Group();
		this.object.name = model.id;

		this.speed = 0;
		this.velocityY = 0;
		this.grounded = true;
		this.running = false;

		this._phase = 0;
		this._time = 0;
		this._jumpHeld = false;

		this.hull = [];
		for ( let i = 0; i < 8; i ++ ) {

			const a = i / 8 * Math.PI * 2;
			this.hull.push( new THREE.Vector2( Math.cos( a ) * RADIUS, Math.sin( a ) * RADIUS ) );

		}

	}

	get name() {

		return this.model.name;

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

	async load( onProgress ) {

		const gltf = await loader.loadAsync( this.model.url, ( e ) => e.total && onProgress?.( e.loaded / e.total ) );
		// Modelos sem esqueleto (como a Vanellope) geram um rig compatível em `prepare`.
		const scene = this.model.prepare ? this.model.prepare( gltf.scene ) : gltf.scene;

		scene.traverse( ( o ) => {

			if ( o.isMesh ) {

				o.castShadow = true;
				o.receiveShadow = true;
				o.frustumCulled = false;

			}

		} );

		this.body = new THREE.Group();
		this.rig = new THREE.Group();
		this.rig.add( scene );
		this.body.add( this.rig );
		this.object.add( this.body );

		const placement = { position: this.object.position.clone(), yaw: this.object.rotation.y };
		this.object.position.set( 0, 0, 0 );
		this.object.rotation.y = 0;

		const find = ( name ) => {

			let found = null;
			scene.traverse( ( o ) => ! found && o.isBone && new RegExp( `^mixamorig:?${ name }(_\\d+)?$` ).test( o.name ) && ( found = o ) );
			return found;

		};

		this.bones = {};
		for ( const name of [ 'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
			'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
			'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftToeBase', 'RightToeBase' ] ) {

			this.bones[ name ] = find( name );

		}

		this.refresh();

		const right = this.boneLocal( this.bones.RightUpLeg ).sub( this.boneLocal( this.bones.LeftUpLeg ) ).setY( 0 ).normalize();
		const facing = new THREE.Vector3().crossVectors( AXIS_Y, right );
		this.rig.rotation.y = - Math.atan2( - facing.x, - facing.z );
		this.refresh();

		const box = new THREE.Box3().setFromObject( this.rig, true );
		const scale = this.model.height / ( box.max.y - box.min.y );
		this.rig.scale.setScalar( scale );
		this.refresh();
		box.setFromObject( this.rig, true );
		const center = box.getCenter( new THREE.Vector3() );
		this.rig.position.set( - center.x, - box.min.y, - center.z );
		this.refresh();

		this.rest = new Map();
		for ( const b of Object.values( this.bones ) ) if ( b ) this.rest.set( b, b.quaternion.clone() );

		const dir = ( from, to ) => this.boneLocal( to ).sub( this.boneLocal( from ) ).normalize();
		const b = this.bones;
		this.armRest = {
			left: { upper: dir( b.LeftArm, b.LeftForeArm ) },
			right: { upper: dir( b.RightArm, b.RightForeArm ) },
		};

		const len = ( from, to ) => this.boneLocal( to ).distanceTo( this.boneLocal( from ) );
		this.armLength = { upper: len( b.LeftArm, b.LeftForeArm ), fore: len( b.LeftForeArm, b.LeftHand ) };

		this.ankleHeight = Math.min( this.boneLocal( b.LeftFoot ).y, this.boneLocal( b.RightFoot ).y );

		this.chestRest = this.charQuaternion( b.Spine2 );

		this.fingers = {};
		for ( const side of [ 'Left', 'Right' ] ) {

			this.fingers[ side ] = {};
			for ( const finger of [ 'Thumb', 'Index', 'Middle', 'Ring', 'Pinky' ] ) {

				const joints = [ 1, 2, 3 ].map( ( i ) => find( `${ side }Hand${ finger }${ i }` ) ).filter( Boolean );
				this.fingers[ side ][ finger ] = joints;
				for ( const j of joints ) this.rest.set( j, j.quaternion.clone() );

			}

		}

		this.object.position.copy( placement.position );
		this.object.rotation.y = placement.yaw;

		return this;

	}

	refresh() {

		this.object.updateMatrixWorld( true );
		this.object.traverse( ( o ) => o.isSkinnedMesh && o.skeleton.update() );

	}

	boneLocal( bone, target = new THREE.Vector3() ) {

		return this.object.worldToLocal( bone.getWorldPosition( target ) );

	}

	charQuaternion( bone ) {

		const root = this.object.getWorldQuaternion( new THREE.Quaternion() ).invert();
		return root.multiply( bone.getWorldQuaternion( new THREE.Quaternion() ) );

	}

	eyePosition( target = new THREE.Vector3() ) {

		this.bones.Head.getWorldPosition( target );
		return target.addScaledVector( this.forward(), this.model.eyeForward ?? 0.14 ).add( new THREE.Vector3( 0, this.model.eyeUp ?? 0.08, 0 ) );

	}

	// `floor`: altura do assoalho do carro no espaço de `parent` (se souber), para as pernas não
	// atravessarem: o joelho vai esticando até o pé ficar acima dele.
	sit( parent, hips, floor = null ) {

		this.seated = true;
		this._legPose = { thigh: 1.35, knee: - 1.0, foot: 0.35 };
		this.speed = 0;
		this.velocityY = 0;
		this.grounded = true;
		this._hands = null;

		parent.add( this.object );
		this.object.position.set( 0, 0, 0 );
		this.object.rotation.set( 0, 0, 0 );
		this.animate( 0 );
		this.object.updateMatrixWorld( true );

		this.object.position.copy( hips ).sub( this.boneLocal( this.bones.Hips ) );
		if ( floor !== null ) this.fitLegs( parent, floor );

	}

	fitLegs( parent, floor ) {

		const foot = new THREE.Vector3();
		const above = () => {

			this.animate( 0 );
			this.object.updateMatrixWorld( true );
			const lowest = Math.min(
				parent.worldToLocal( this.bones.LeftFoot.getWorldPosition( foot ) ).y,
				parent.worldToLocal( this.bones.RightFoot.getWorldPosition( foot ) ).y
			);
			return lowest - this.ankleHeight * 0.6 >= floor;

		};

		const pose = this._legPose;
		for ( const thigh of [ 1.35, 1.5, 1.65 ] ) for ( let knee = - 1.0; knee <= 0.001; knee += 0.1 ) {

			pose.thigh = thigh;
			pose.knee = knee;
			pose.foot = 0.35 * - knee;
			if ( above() ) return;

		}

	}

	stand( scene, position, yaw ) {

		this.seated = false;
		scene.add( this.object );
		this.object.position.copy( position );
		this.object.rotation.set( 0, yaw, 0 );
		this.animate( 0 );

	}

	update( dt, input, colliders = [] ) {

		if ( ! this.rig ) return;

		this._time += dt;

		if ( this.seated ) {

			this._hands = input.hands ?? null;
			this.animate( dt );
			return;

		}

		if ( this.dancing ) {

			const t = this.danceClock();
			if ( t >= this.routine.duration ) {

				this.stopDance();

			} else {

				for ( const e of this.routine.events ?? [] ) {

					if ( t >= e.t && ! this._fired.has( e ) ) {

						this._fired.add( e );
						this.onRoutineEvent?.( e.name );

					}

				}

				this._pose = this.routine.pose( t );
				this.speed = 0;
				this.animate( dt );
				this.plantFoot( colliders );
				this.body.position.y += this._pose.lift ?? 0;
				return;

			}

		}

		const move = input.move ?? new THREE.Vector3();
		this.running = !! input.run;

		const amount = Math.min( 1, move.length() );
		let target;

		if ( input.lockFacing ) {

			this.object.rotation.y += ( input.turn ?? 0 ) * 2.6 * dt;
			const along = this.forward().dot( move );
			target = along >= 0 ? along * ( this.running ? RUN_SPEED : WALK_SPEED ) : along * WALK_SPEED * 0.7;

		} else {

			if ( amount > 0.01 ) {

				const yaw = Math.atan2( - move.x, - move.z );
				const d = Math.atan2( Math.sin( yaw - this.yaw ), Math.cos( yaw - this.yaw ) );
				this.object.rotation.y += THREE.MathUtils.clamp( d, - TURN_RATE * dt, TURN_RATE * dt );

			}

			const facing = amount > 0.01 ? Math.max( 0, this.forward().dot( move ) / amount ) : 0;
			target = amount * facing * ( this.running ? RUN_SPEED : WALK_SPEED );

		}

		const accel = ( this.grounded ? ACCEL : ACCEL * 0.3 ) * dt;
		this.speed += THREE.MathUtils.clamp( target - this.speed, - accel * 1.5, accel * 1.5 );

		if ( input.jump && ! this._jumpHeld && this.grounded ) {

			this.velocityY = JUMP_SPEED;
			this.grounded = false;

		}

		this._jumpHeld = !! input.jump;

		this.move( dt, colliders );
		this.fall( dt );
		this.animate( dt );

	}

	groundHeight() {

		const p = this.object.position;
		const h = this.terrain ? this.terrain.height( p.x, p.z, p.y, STEP ) : 0;
		return h === - Infinity ? p.y : h;

	}

	// Gravidade e apoio no chão (que pode ter relevo: pista, rampa, gramado).
	fall( dt ) {

		const pos = this.object.position;
		const ground = this.groundHeight();

		if ( this.grounded && pos.y - ground > 0.35 ) this.grounded = false;

		if ( this.grounded ) {

			pos.y = ground;
			return;

		}

		this.velocityY -= GRAVITY * dt;
		pos.y += this.velocityY * dt;

		if ( pos.y <= ground ) {

			pos.y = ground;
			this.velocityY = 0;
			this.grounded = true;

		}

	}

	move( dt, colliders ) {

		const step = this.forward().multiplyScalar( this.speed * dt );
		if ( step.lengthSq() === 0 ) return;

		const pos = this.object.position;
		const wasColliding = this.collides( colliders );

		pos.add( step );
		if ( wasColliding || ! this.collides( colliders ) ) return;

		pos.sub( step );
		pos.x += step.x;
		if ( ! this.collides( colliders ) ) return;
		pos.x -= step.x;
		pos.z += step.z;
		if ( ! this.collides( colliders ) ) return;
		pos.z -= step.z;
		this.speed = 0;

	}

	collides( colliders ) {

		if ( ! colliders.length ) return false;

		const p = new THREE.Vector2();

		for ( const h of this.hull ) {

			p.set( this.position.x + h.x, this.position.z + h.y );
			for ( const box of colliders ) if ( box.containsPoint( p ) ) return true;

		}

		return false;

	}

	footprint( target = new THREE.Box2() ) {

		return target.set(
			new THREE.Vector2( this.position.x - RADIUS, this.position.z - RADIUS ),
			new THREE.Vector2( this.position.x + RADIUS, this.position.z + RADIUS )
		);

	}

	animate( dt ) {

		const b = this.bones;
		for ( const [ bone, q ] of this.rest ) bone.quaternion.copy( q );

		if ( this.seated ) return this.seatedPose();
		if ( this.dancing ) return this.applyPose( this._pose );

		const speed = Math.abs( this.speed );
		const run = THREE.MathUtils.clamp( ( speed - WALK_SPEED ) / ( RUN_SPEED - WALK_SPEED ), 0, 1 );
		const gait = THREE.MathUtils.clamp( speed / WALK_SPEED, 0, 1 );
		const stride = THREE.MathUtils.lerp( 1.4, 2.6, run );
		this._phase += this.speed / stride * Math.PI * 2 * dt;
		const p = this._phase;
		const air = this.grounded ? 0 : 1;

		const legSwing = gait * THREE.MathUtils.lerp( 0.45, 0.85, run ) * ( 1 - air );
		const kneeMax = gait * THREE.MathUtils.lerp( 0.7, 1.6, run ) * ( 1 - air );
		const armSwing = gait * THREE.MathUtils.lerp( 0.35, 0.9, run ) * ( 1 - air );
		const breathe = Math.sin( this._time * 2 ) * 0.02 * ( 1 - gait );

		const twist = Math.sin( p ) * 0.12 * gait;
		this.rotate( b.Hips, AXIS_Y, - twist );
		this.rotate( b.Spine, AXIS_X, - run * 0.25 - breathe );
		this.rotate( b.Spine1, AXIS_Y, twist * 1.6 );
		this.rotate( b.Neck, AXIS_X, run * 0.15 );

		for ( const [ side, sign ] of [ [ 'Left', 1 ], [ 'Right', - 1 ] ] ) {

			const s = Math.sin( p ) * sign;
			const c = Math.cos( p ) * sign;
			this.rotate( b[ `${ side }UpLeg` ], AXIS_X, legSwing * s + air * 0.75 + run * 0.1 );
			this.rotate( b[ `${ side }Leg` ], AXIS_X, - ( 0.05 + kneeMax * Math.max( 0, c ) + air * 1.3 ) );
			this.rotate( b[ `${ side }Foot` ], AXIS_X, legSwing * 0.3 * Math.max( 0, - s ) + air * 0.3 );

		}

		for ( const [ side, sign ] of [ [ 'left', 1 ], [ 'right', - 1 ] ] ) {

			const Side = side === 'left' ? 'Left' : 'Right';
			const rest = this.armRest[ side ].upper;
			const down = new THREE.Vector3( - sign * 0.18, - 1, 0.05 ).normalize();
			const up = new THREE.Vector3( - sign * 0.7, 0.7, 0 ).normalize();
			const lower = new THREE.Quaternion().setFromUnitVectors( rest, down.lerp( up, air * 0.7 ).normalize() );
			const swing = new THREE.Quaternion().setFromAxisAngle( AXIS_X, - armSwing * Math.sin( p ) * sign );
			this.rotateQ( b[ `${ Side }Arm` ], swing.multiply( lower ) );
			this.rotate( b[ `${ Side }ForeArm` ], AXIS_X, 0.25 + run * 1.1 );

		}

		this.body.position.y = - Math.abs( Math.sin( p ) ) * 0.04 * gait * ( 1 + run );

	}

	seatedPose() {

		const b = this.bones;
		this.body.position.y = 0;

		this.rotate( b.Spine, AXIS_X, 0.18 );
		this.rotate( b.Neck, AXIS_X, - 0.12 );

		for ( const side of [ 'Left', 'Right' ] ) {

			const legs = this._legPose;
			this.rotate( b[ `${ side }UpLeg` ], AXIS_X, legs.thigh );
			this.rotate( b[ `${ side }Leg` ], AXIS_X, legs.knee );
			this.rotate( b[ `${ side }Foot` ], AXIS_X, legs.foot );

		}

		for ( const [ side, sign ] of [ [ 'Left', 1 ], [ 'Right', - 1 ] ] ) {

			const shoulder = this.boneLocal( b[ `${ side }Arm` ] );
			const target = this._hands
				? this.object.worldToLocal( this._hands[ sign > 0 ? 0 : 1 ].clone() )
				: shoulder.clone().add( new THREE.Vector3( sign * 0.12, - 0.05, - 0.4 ) );

			this.reach( b[ `${ side }Arm` ], b[ `${ side }ForeArm` ], b[ `${ side }Hand` ], target, new THREE.Vector3( - sign * 0.6, - 1, 0.2 ) );
			this.grip( side );

		}

	}

	grip( side, fingers = [ 'Index', 'Middle', 'Ring', 'Pinky' ], amount = 1, thumb = true ) {

		const f = this.fingers[ side ];
		if ( ! f.Index.length || ! f.Pinky.length || ! f.Middle.length ) return;

		const wrist = this.boneLocal( this.bones[ `${ side }Hand` ] );
		const along = this.boneLocal( f.Middle[ 0 ] ).sub( wrist ).normalize();
		const across = this.boneLocal( f.Index[ 0 ] ).sub( this.boneLocal( f.Pinky[ 0 ] ) ).normalize();
		const axis = new THREE.Vector3().crossVectors( across, along ).normalize().multiplyScalar( GRIP_SIGN );

		for ( const finger of fingers ) {

			for ( const [ i, joint ] of f[ finger ].entries() ) this.rotate( joint, axis, [ 1.2, 1.3, 0.9 ][ i ] * amount );

		}

		if ( thumb ) for ( const joint of f.Thumb.slice( 1 ) ) this.rotate( joint, along, - GRIP_SIGN * ( side === 'Left' ? 1 : - 1 ) * 0.6 * amount );

	}

	startDance( clock, routine ) {

		this.dancing = true;
		this.danceClock = clock;
		this.routine = routine;
		this._fired = new Set();
		this._stance = null;
		this._pose = routine.pose( 0 );

	}

	stopDance() {

		if ( ! this.dancing ) return;
		this.dancing = false;
		this.speed = 0;
		this.onDanceEnd?.();

	}

	plantFoot( colliders ) {

		const left = this.boneLocal( this.bones.LeftFoot ), right = this.boneLocal( this.bones.RightFoot );

		let stance = this._stance?.side ?? ( left.y <= right.y ? 'Left' : 'Right' );
		const current = stance === 'Left' ? left : right;
		const other = stance === 'Left' ? right : left;
		if ( other.y < current.y - 0.015 ) stance = stance === 'Left' ? 'Right' : 'Left';

		this.body.position.y = this.ankleHeight - Math.min( left.y, right.y );
		this.object.updateMatrixWorld( true );

		const foot = this.bones[ `${ stance }Foot` ].getWorldPosition( new THREE.Vector3() );

		if ( this._stance?.side === stance ) {

			const before = this.object.position.clone();
			this.object.position.x += this._stance.point.x - foot.x;
			this.object.position.z += this._stance.point.z - foot.z;
			if ( ! this.collides( colliders ) ) return;
			this.object.position.copy( before );

		}

		this._stance = { side: stance, point: foot };

	}

	applyPose( p ) {

		const b = this.bones;
		this.body.position.y = 0;

		this.rotate( b.Hips, AXIS_Y, p.yaw - p.twist * 0.5 );
		this.rotate( b.Spine, AXIS_X, p.lean );
		this.rotate( b.Spine, AXIS_Z, p.roll );
		this.rotate( b.Spine1, AXIS_Y, p.twist );
		this.rotate( b.Neck, AXIS_X, p.neck );
		this.rotate( b.Head, AXIS_X, p.head );

		for ( const side of [ 'Left', 'Right' ] ) {

			const [ thigh, knee, foot ] = p.legs[ side[ 0 ] ];
			this.rotate( b[ `${ side }UpLeg` ], AXIS_X, thigh );
			this.rotate( b[ `${ side }Leg` ], AXIS_X, knee );
			this.rotate( b[ `${ side }Foot` ], AXIS_X, foot );

		}

		const tilt = p.lean + p.neck + p.head;
		const chin = this.boneLocal( b.Head ).add( new THREE.Vector3( 0, - 0.09, - 0.12 ).applyAxisAngle( AXIS_X, tilt * 0.4 ) );

		const chest = this.charQuaternion( b.Spine2 ).multiply( this.chestRest.clone().invert() );

		for ( const [ side, sign ] of [ [ 'Left', 1 ], [ 'Right', - 1 ] ] ) {

			const [ out, up, back, toChin ] = p.hands[ side[ 0 ] ];
			const shoulder = this.boneLocal( b[ `${ side }Arm` ] );
			const offset = new THREE.Vector3( - sign * out, up, back ).applyQuaternion( chest );
			const target = shoulder.add( offset ).lerp( chin, toChin );

			const arc = Math.sin( Math.PI * toChin ) * 0.22;
			target.add( new THREE.Vector3( - sign * arc, 0, - arc ).applyQuaternion( chest ) );
			const pole = new THREE.Vector3( - sign * 0.5, - 0.8, 0.8 ).lerp( new THREE.Vector3( - sign * 1, - 0.4, - 0.4 ), toChin ).applyQuaternion( chest );
			this.reach( b[ `${ side }Arm` ], b[ `${ side }ForeArm` ], b[ `${ side }Hand` ], target, pole );

			const thwip = p.thwip?.[ side[ 0 ] ] ?? 0;
			if ( thwip > 0.01 ) this.grip( side, [ 'Middle', 'Ring' ], thwip * 1.15, false );

		}

	}

	reach( upper, fore, hand, target, pole ) {

		const { upper: a, fore: b } = this.armLength;
		const shoulder = this.boneLocal( upper );
		const toTarget = target.clone().sub( shoulder );
		const dist = THREE.MathUtils.clamp( toTarget.length(), Math.abs( a - b ) + 1e-3, a + b - 1e-3 );
		const dir = toTarget.normalize();

		const cosA = ( a * a + dist * dist - b * b ) / ( 2 * a * dist );
		const bend = pole.clone().addScaledVector( dir, - pole.dot( dir ) ).normalize();
		const elbow = shoulder.clone().addScaledVector( dir, a * cosA ).addScaledVector( bend, a * Math.sqrt( 1 - cosA * cosA ) );

		const current = this.boneLocal( fore ).sub( shoulder ).normalize();
		this.rotateQ( upper, new THREE.Quaternion().setFromUnitVectors( current, elbow.sub( shoulder ).normalize() ) );

		const wrist = this.boneLocal( fore );
		const forearm = this.boneLocal( hand ).sub( wrist ).normalize();
		this.rotateQ( fore, new THREE.Quaternion().setFromUnitVectors( forearm, target.clone().sub( wrist ).normalize() ) );

	}

	rotate( bone, axis, angle ) {

		if ( bone && angle ) this.rotateQ( bone, new THREE.Quaternion().setFromAxisAngle( axis, angle ) );

	}

	rotateQ( bone, q ) {

		if ( ! bone ) return;

		bone.parent.updateWorldMatrix( true, false );
		const parent = bone.parent.getWorldQuaternion( new THREE.Quaternion() );
		const root = this.object.getWorldQuaternion( new THREE.Quaternion() ).invert();
		const P = root.multiply( parent );

		bone.quaternion.premultiply( P ).premultiply( q ).premultiply( P.invert() );

	}

}
