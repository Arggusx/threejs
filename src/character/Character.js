import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DANCE_DURATION, dancePose } from './dance.js';

// Personagem a pé: anda, corre, pula e colide com o mundo. O modelo não traz animações,
// então o ciclo de caminhada é feito girando os ossos (rig do Mixamo) a cada quadro.
// Unidades em metros, frente do personagem apontando para -Z (igual aos carros).

const WALK_SPEED = 1.8;
const RUN_SPEED = 7;
const ACCEL = 14; // m/s²
const TURN_RATE = 12; // rad/s
const GRAVITY = 22;
const JUMP_SPEED = 7.5;
const RADIUS = 0.3;
const GRIP_SIGN = 1; // sentido em que os dedos fecham (depende do rig)

const AXIS_X = new THREE.Vector3( 1, 0, 0 );
const AXIS_Y = new THREE.Vector3( 0, 1, 0 );
const AXIS_Z = new THREE.Vector3( 0, 0, 1 );

const loader = new GLTFLoader();

export class Character {

	constructor( model ) {

		this.model = model;
		this.object = new THREE.Group(); // posição/rotação no mundo
		this.object.name = model.id;

		this.speed = 0; // m/s no plano, positivo = para a frente
		this.velocityY = 0;
		this.grounded = true;
		this.running = false;

		this._phase = 0;
		this._time = 0;
		this._jumpHeld = false;

		// Contorno para colisão: um círculo de 8 pontos em volta dos pés
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
		const scene = gltf.scene;

		scene.traverse( ( o ) => {

			if ( o.isMesh ) {

				o.castShadow = true;
				o.receiveShadow = true;
				o.frustumCulled = false; // a caixa da malha com esqueleto não acompanha a pose

			}

		} );

		// `body` balança no passo; `rig` corrige escala e orientação do arquivo
		this.body = new THREE.Group();
		this.rig = new THREE.Group();
		this.rig.add( scene );
		this.body.add( this.rig );
		this.object.add( this.body );

		// As medidas abaixo são feitas com o personagem na origem do mundo
		const placement = { position: this.object.position.clone(), yaw: this.object.rotation.y };
		this.object.position.set( 0, 0, 0 );
		this.object.rotation.y = 0;

		// Ossos do Mixamo: "mixamorig:Hips_01" vira "mixamorigHips_01" no GLTFLoader (tira o ":")
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

		// Orientação: o lado direito vai do quadril esquerdo ao direito; a frente é "cima × direita"
		const right = this.boneLocal( this.bones.RightUpLeg ).sub( this.boneLocal( this.bones.LeftUpLeg ) ).setY( 0 ).normalize();
		const facing = new THREE.Vector3().crossVectors( AXIS_Y, right );
		this.rig.rotation.y = - Math.atan2( - facing.x, - facing.z );
		this.refresh();

		// Escala para a altura desejada e pés no chão
		const box = new THREE.Box3().setFromObject( this.rig, true );
		const scale = this.model.height / ( box.max.y - box.min.y );
		this.rig.scale.setScalar( scale );
		this.refresh();
		box.setFromObject( this.rig, true );
		const center = box.getCenter( new THREE.Vector3() );
		this.rig.position.set( - center.x, - box.min.y, - center.z );
		this.refresh();

		// Pose de descanso (T-pose) e direção de repouso de cada membro, no espaço do personagem
		this.rest = new Map();
		for ( const b of Object.values( this.bones ) ) if ( b ) this.rest.set( b, b.quaternion.clone() );

		const dir = ( from, to ) => this.boneLocal( to ).sub( this.boneLocal( from ) ).normalize();
		const b = this.bones;
		this.armRest = {
			left: { upper: dir( b.LeftArm, b.LeftForeArm ) },
			right: { upper: dir( b.RightArm, b.RightForeArm ) },
		};

		// Comprimento do braço e do antebraço (para alcançar o volante)
		const len = ( from, to ) => this.boneLocal( to ).distanceTo( this.boneLocal( from ) );
		this.armLength = { upper: len( b.LeftArm, b.LeftForeArm ), fore: len( b.LeftForeArm, b.LeftHand ) };

		// Altura do tornozelo em pé (para manter os pés no chão durante a dança)
		this.ankleHeight = Math.min( this.boneLocal( b.LeftFoot ).y, this.boneLocal( b.RightFoot ).y );

		// Orientação do peito em repouso (referência para os braços acompanharem o tronco)
		this.chestRest = this.charQuaternion( b.Spine2 );

		// Dedos (falanges 1 a 3 de cada um), para fechar a mão no volante
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

	// Atualiza matrizes e esqueleto (a caixa "precisa" da malha usa as matrizes dos ossos)
	refresh() {

		this.object.updateMatrixWorld( true );
		this.object.traverse( ( o ) => o.isSkinnedMesh && o.skeleton.update() );

	}

	// Posição de um osso no espaço do personagem (`this.object`)
	boneLocal( bone, target = new THREE.Vector3() ) {

		return this.object.worldToLocal( bone.getWorldPosition( target ) );

	}

	// Orientação de um osso no espaço do personagem
	charQuaternion( bone ) {

		const root = this.object.getWorldQuaternion( new THREE.Quaternion() ).invert();
		return root.multiply( bone.getWorldQuaternion( new THREE.Quaternion() ) );

	}

	// Posição dos olhos no mundo (câmera em primeira pessoa)
	eyePosition( target = new THREE.Vector3() ) {

		this.bones.Head.getWorldPosition( target );
		return target.addScaledVector( this.forward(), 0.14 ).add( new THREE.Vector3( 0, 0.08, 0 ) );

	}

	// ---------------------------------------------------------------- sentado no carro

	// Senta no banco do motorista: vira filho de `parent` (o chassi do carro), com o quadril em `hips`
	sit( parent, hips ) {

		this.seated = true;
		this.speed = 0;
		this.velocityY = 0;
		this.grounded = true;
		this._hands = null;

		parent.add( this.object );
		this.object.position.set( 0, 0, 0 );
		this.object.rotation.set( 0, 0, 0 );
		this.animate( 0 );
		this.object.updateMatrixWorld( true );

		// Desloca o corpo para que o quadril (na pose sentada) fique sobre o assento
		this.object.position.copy( hips ).sub( this.boneLocal( this.bones.Hips ) );

	}

	// Levanta e volta para o mundo em `position`, olhando para `yaw`
	stand( scene, position, yaw ) {

		this.seated = false;
		scene.add( this.object );
		this.object.position.copy( position );
		this.object.rotation.set( 0, yaw, 0 );
		this.animate( 0 );

	}

	// ---------------------------------------------------------------- movimento

	// input: { move: Vector3 (direção desejada no mundo, comprimento 0..1), run, jump,
	//         lockFacing (não vira para o movimento), turn (-1..1, só com lockFacing) }
	update( dt, input, colliders = [] ) {

		if ( ! this.rig ) return;

		this._time += dt;

		if ( this.seated ) {

			// No carro só segura o volante (input.hands = [esquerda, direita], pontos do aro no mundo)
			this._hands = input.hands ?? null;
			this.animate( dt );
			return;

		}

		if ( this.dancing ) {

			// Dançando: o relógio é o tempo da música; anda para a frente no ritmo da coreografia
			const t = this.danceClock();
			if ( t >= DANCE_DURATION ) {

				this.stopDance();

			} else {

				this._pose = dancePose( t );
				this.speed = 0;
				this.animate( dt );
				this.plantFoot( colliders );
				return;

			}

		}

		const move = input.move ?? new THREE.Vector3();
		this.running = !! input.run;

		const amount = Math.min( 1, move.length() );
		let target;

		if ( input.lockFacing ) {

			// Controle "tanque" (câmeras de perseguição e primeira pessoa): A/D giram, S anda de costas
			this.object.rotation.y += ( input.turn ?? 0 ) * 2.6 * dt;
			const along = this.forward().dot( move );
			target = along >= 0 ? along * ( this.running ? RUN_SPEED : WALK_SPEED ) : along * WALK_SPEED * 0.7;

		} else {

			// Vira para a direção do movimento e só anda depois de quase virado (evita "deslizar de lado")
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

		// Pulo
		if ( input.jump && ! this._jumpHeld && this.grounded ) {

			this.velocityY = JUMP_SPEED;
			this.grounded = false;

		}

		this._jumpHeld = !! input.jump;

		if ( ! this.grounded ) {

			this.velocityY -= GRAVITY * dt;
			this.object.position.y += this.velocityY * dt;

			if ( this.object.position.y <= 0 ) {

				this.object.position.y = 0;
				this.velocityY = 0;
				this.grounded = true;

			}

		}

		this.move( dt, colliders );
		this.animate( dt );

	}

	move( dt, colliders ) {

		const step = this.forward().multiplyScalar( this.speed * dt );
		if ( step.lengthSq() === 0 ) return;

		const pos = this.object.position;
		const wasColliding = this.collides( colliders );

		pos.add( step );
		if ( wasColliding || ! this.collides( colliders ) ) return;

		// Bateu: tenta deslizar ao longo da parede (só X, depois só Z)
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

	// ---------------------------------------------------------------- animação procedural

	animate( dt ) {

		const b = this.bones;
		for ( const [ bone, q ] of this.rest ) bone.quaternion.copy( q );

		if ( this.seated ) return this.seatedPose();
		if ( this.dancing ) return this.applyPose( this._pose );

		// Passada: a fase avança com a distância percorrida
		const speed = Math.abs( this.speed );
		const run = THREE.MathUtils.clamp( ( speed - WALK_SPEED ) / ( RUN_SPEED - WALK_SPEED ), 0, 1 );
		const gait = THREE.MathUtils.clamp( speed / WALK_SPEED, 0, 1 ); // 0 parado, 1 andando
		const stride = THREE.MathUtils.lerp( 1.4, 2.6, run );
		this._phase += this.speed / stride * Math.PI * 2 * dt;
		const p = this._phase;
		const air = this.grounded ? 0 : 1;

		const legSwing = gait * THREE.MathUtils.lerp( 0.45, 0.85, run ) * ( 1 - air );
		const kneeMax = gait * THREE.MathUtils.lerp( 0.7, 1.6, run ) * ( 1 - air );
		const armSwing = gait * THREE.MathUtils.lerp( 0.35, 0.9, run ) * ( 1 - air );
		const breathe = Math.sin( this._time * 2 ) * 0.02 * ( 1 - gait );

		// Tronco: inclina para a frente ao correr e torce contra o quadril
		const twist = Math.sin( p ) * 0.12 * gait;
		this.rotate( b.Hips, AXIS_Y, - twist );
		this.rotate( b.Spine, AXIS_X, - run * 0.25 - breathe );
		this.rotate( b.Spine1, AXIS_Y, twist * 1.6 );
		this.rotate( b.Neck, AXIS_X, run * 0.15 );

		// Pernas (no ar: encolhidas)
		for ( const [ side, sign ] of [ [ 'Left', 1 ], [ 'Right', - 1 ] ] ) {

			const s = Math.sin( p ) * sign;
			const c = Math.cos( p ) * sign;
			this.rotate( b[ `${ side }UpLeg` ], AXIS_X, legSwing * s + air * 0.75 + run * 0.1 );
			this.rotate( b[ `${ side }Leg` ], AXIS_X, - ( 0.05 + kneeMax * Math.max( 0, c ) + air * 1.3 ) );
			this.rotate( b[ `${ side }Foot` ], AXIS_X, legSwing * 0.3 * Math.max( 0, - s ) + air * 0.3 );

		}

		// Braços: abaixa a partir da T-pose e balança ao contrário das pernas
		for ( const [ side, sign ] of [ [ 'left', 1 ], [ 'right', - 1 ] ] ) {

			const Side = side === 'left' ? 'Left' : 'Right';
			const rest = this.armRest[ side ].upper;
			const down = new THREE.Vector3( - sign * 0.18, - 1, 0.05 ).normalize();
			const up = new THREE.Vector3( - sign * 0.7, 0.7, 0 ).normalize(); // braços abertos no pulo
			const lower = new THREE.Quaternion().setFromUnitVectors( rest, down.lerp( up, air * 0.7 ).normalize() );
			const swing = new THREE.Quaternion().setFromAxisAngle( AXIS_X, - armSwing * Math.sin( p ) * sign );
			this.rotateQ( b[ `${ Side }Arm` ], swing.multiply( lower ) );
			this.rotate( b[ `${ Side }ForeArm` ], AXIS_X, 0.25 + run * 1.1 );

		}

		// Sobe e desce a cada passo
		this.body.position.y = - Math.abs( Math.sin( p ) ) * 0.04 * gait * ( 1 + run );

	}

	// Sentado ao volante: coxas para a frente, joelhos dobrados, encosto reclinado e mãos no volante
	seatedPose() {

		const b = this.bones;
		this.body.position.y = 0;

		this.rotate( b.Spine, AXIS_X, 0.18 );
		this.rotate( b.Neck, AXIS_X, - 0.12 );

		for ( const side of [ 'Left', 'Right' ] ) {

			this.rotate( b[ `${ side }UpLeg` ], AXIS_X, 1.35 );
			this.rotate( b[ `${ side }Leg` ], AXIS_X, - 1.0 );
			this.rotate( b[ `${ side }Foot` ], AXIS_X, 0.35 );

		}

		for ( const [ side, sign ] of [ [ 'Left', 1 ], [ 'Right', - 1 ] ] ) {

			// Sem alvo (ex.: logo ao sentar): mãos à frente do peito
			const shoulder = this.boneLocal( b[ `${ side }Arm` ] );
			const target = this._hands
				? this.object.worldToLocal( this._hands[ sign > 0 ? 0 : 1 ].clone() )
				: shoulder.clone().add( new THREE.Vector3( sign * 0.12, - 0.05, - 0.4 ) );

			// Cotovelo para baixo e para fora
			this.reach( b[ `${ side }Arm` ], b[ `${ side }ForeArm` ], b[ `${ side }Hand` ], target, new THREE.Vector3( - sign * 0.6, - 1, 0.2 ) );
			this.grip( side );

		}

	}

	// Fecha a mão: cada falange gira em torno do eixo "de lado" da palma (do mindinho ao indicador)
	grip( side ) {

		const f = this.fingers[ side ];
		if ( ! f.Index.length || ! f.Pinky.length || ! f.Middle.length ) return;

		const wrist = this.boneLocal( this.bones[ `${ side }Hand` ] );
		const along = this.boneLocal( f.Middle[ 0 ] ).sub( wrist ).normalize();
		const across = this.boneLocal( f.Index[ 0 ] ).sub( this.boneLocal( f.Pinky[ 0 ] ) ).normalize();
		const axis = new THREE.Vector3().crossVectors( across, along ).normalize().multiplyScalar( GRIP_SIGN );

		for ( const finger of [ 'Index', 'Middle', 'Ring', 'Pinky' ] ) {

			for ( const [ i, joint ] of f[ finger ].entries() ) this.rotate( joint, axis, [ 1.2, 1.3, 0.9 ][ i ] );

		}

		// Polegar: dobra menos, por cima do aro
		for ( const joint of f.Thumb.slice( 1 ) ) this.rotate( joint, along, - GRIP_SIGN * ( side === 'Left' ? 1 : - 1 ) * 0.6 );

	}

	// ---------------------------------------------------------------- dança

	// `clock` devolve os segundos desde o início da música (assim a dança fica no ritmo do áudio)
	startDance( clock ) {

		this.dancing = true;
		this.danceClock = clock;
		this._stance = null;
		this._pose = dancePose( 0 );

	}

	stopDance() {

		if ( ! this.dancing ) return;
		this.dancing = false;
		this.speed = 0;
		this.onDanceEnd?.();

	}

	// Pé de apoio travado no chão: o pé mais baixo não escorrega e é ele que empurra o corpo para a
	// frente (sem isso o personagem desliza, como num "moonwalk"). Também encosta esse pé no chão.
	plantFoot( colliders ) {

		const left = this.boneLocal( this.bones.LeftFoot ), right = this.boneLocal( this.bones.RightFoot );

		// Troca de pé só quando o outro fica claramente mais baixo (evita tremer com os dois no chão)
		let stance = this._stance?.side ?? ( left.y <= right.y ? 'Left' : 'Right' );
		const current = stance === 'Left' ? left : right;
		const other = stance === 'Left' ? right : left;
		if ( other.y < current.y - 0.015 ) stance = stance === 'Left' ? 'Right' : 'Left';

		this.body.position.y = this.ankleHeight - Math.min( left.y, right.y );
		this.object.updateMatrixWorld( true );

		const foot = this.bones[ `${ stance }Foot` ].getWorldPosition( new THREE.Vector3() );

		if ( this._stance?.side === stance ) {

			// Move o corpo para o pé voltar ao ponto onde pisou (se não bater em nada)
			const before = this.object.position.clone();
			this.object.position.x += this._stance.point.x - foot.x;
			this.object.position.z += this._stance.point.z - foot.z;
			if ( ! this.collides( colliders ) ) return;
			this.object.position.copy( before );

		}

		this._stance = { side: stance, point: foot };

	}

	// Aplica uma pose de `dance.js` aos ossos
	applyPose( p ) {

		const b = this.bones;
		this.body.position.y = 0; // a altura certa vem depois, em plantFoot()

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

		// Queixo: um pouco à frente e abaixo do osso da cabeça, acompanhando a inclinação do pescoço
		const tilt = p.lean + p.neck + p.head;
		const chin = this.boneLocal( b.Head ).add( new THREE.Vector3( 0, - 0.09, - 0.12 ).applyAxisAngle( AXIS_X, tilt * 0.4 ) );

		// As posições das mãos (e a direção do cotovelo) são relativas ao peito: quando o tronco gira ou
		// inclina, os braços vão junto (sem isso a mão "ficava para trás" e atravessava as costas)
		const chest = this.charQuaternion( b.Spine2 ).multiply( this.chestRest.clone().invert() );

		for ( const [ side, sign ] of [ [ 'Left', 1 ], [ 'Right', - 1 ] ] ) {

			const [ out, up, back, toChin ] = p.hands[ side[ 0 ] ];
			const shoulder = this.boneLocal( b[ `${ side }Arm` ] );
			const offset = new THREE.Vector3( - sign * out, up, back ).applyQuaternion( chest );
			const target = shoulder.add( offset ).lerp( chin, toChin );

			// Indo para o queixo, a mão faz um arco por fora e pela frente (não corta o peito)
			// e o cotovelo abre para o lado
			const arc = Math.sin( Math.PI * toChin ) * 0.22;
			target.add( new THREE.Vector3( - sign * arc, 0, - arc ).applyQuaternion( chest ) );
			const pole = new THREE.Vector3( - sign * 0.5, - 0.8, 0.8 ).lerp( new THREE.Vector3( - sign * 1, - 0.4, - 0.4 ), toChin ).applyQuaternion( chest );
			this.reach( b[ `${ side }Arm` ], b[ `${ side }ForeArm` ], b[ `${ side }Hand` ], target, pole );

		}

	}

	// IK de dois ossos: leva a mão (`hand`) até `target` (espaço do personagem), dobrando o cotovelo para `pole`
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

	// Gira um osso em torno de um eixo do espaço do personagem
	rotate( bone, axis, angle ) {

		if ( bone && angle ) this.rotateQ( bone, new THREE.Quaternion().setFromAxisAngle( axis, angle ) );

	}

	// Aplica uma rotação `q` (espaço do personagem) a um osso: L' = P⁻¹ · q · P · L,
	// onde P é a orientação do pai no espaço do personagem
	rotateQ( bone, q ) {

		if ( ! bone ) return;

		bone.parent.updateWorldMatrix( true, false );
		const parent = bone.parent.getWorldQuaternion( new THREE.Quaternion() );
		const root = this.object.getWorldQuaternion( new THREE.Quaternion() ).invert();
		const P = root.multiply( parent );

		bone.quaternion.premultiply( P ).premultiply( q ).premultiply( P.invert() );

	}

}
