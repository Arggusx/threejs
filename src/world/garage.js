import * as THREE from 'three';
import { animate, ease } from '../utils/tween.js';

const WIDTH = 6;
const DEPTH = 7.6;
const HEIGHT = 3.2;
const WALL = 0.25;
const DOOR_W = 3.8;
const DOOR_H = 2.6;

export class Garage {

	constructor( position = new THREE.Vector3( 14, 0, - 22 ) ) {

		this.object = new THREE.Group();
		this.object.name = 'garage';
		this.object.position.copy( position );

		this.doorOpen = 0;
		this.doorTarget = false;
		this.lightOn = false;

		this.build();
		this.moveTo( position );

	}

	// Reposiciona a garagem (e recalcula vaga, entrada e colisores).
	moveTo( position ) {

		this.object.position.copy( position );
		const p = position;
		this.parkSpot = new THREE.Vector3( p.x, 0, p.z - 0.25 );
		this.entrance = new THREE.Vector3( p.x, 0, p.z + DEPTH / 2 + WALL );

		const box = ( x0, z0, x1, z1 ) => new THREE.Box2( new THREE.Vector2( p.x + x0, p.z + z0 ), new THREE.Vector2( p.x + x1, p.z + z1 ) );
		const hw = WIDTH / 2, hd = DEPTH / 2;
		this.walls = [
			box( - hw - WALL, - hd - WALL, hw + WALL, - hd ),
			box( - hw - WALL, - hd, - hw, hd + WALL ),
			box( hw, - hd, hw + WALL, hd + WALL ),
			box( - hw, hd, - DOOR_W / 2, hd + WALL ),
			box( DOOR_W / 2, hd, hw, hd + WALL ),
		];
		this.doorCollider = box( - DOOR_W / 2, hd, DOOR_W / 2, hd + WALL );
		this.doorway = box( - DOOR_W / 2, hd - 0.3, DOOR_W / 2, hd + WALL + 0.3 );

	}

	get colliders() {

		return this.doorOpen > 0.9 ? this.walls : [ ...this.walls, this.doorCollider ];

	}

	build() {

		const g = this.object;
		const hw = WIDTH / 2, hd = DEPTH / 2;

		const wallMat = new THREE.MeshStandardMaterial( { color: 0xd9d4ca, roughness: 0.92 } );
		const trimMat = new THREE.MeshStandardMaterial( { color: 0x2b2d31, roughness: 0.6, metalness: 0.3 } );
		const floorMat = new THREE.MeshStandardMaterial( { color: 0x6b6e74, roughness: 0.22, metalness: 0.05 } );

		const add = ( geometry, material, x, y, z, { cast = true } = {} ) => {

			const mesh = new THREE.Mesh( geometry, material );
			mesh.position.set( x, y, z );
			mesh.castShadow = cast;
			mesh.receiveShadow = true;
			g.add( mesh );
			return mesh;

		};

		add( new THREE.BoxGeometry( WIDTH, 0.04, DEPTH ), floorMat, 0, 0.02, 0, { cast: false } );
		const lineMat = new THREE.MeshStandardMaterial( { color: 0xf2c200, roughness: 0.5 } );
		for ( const sign of [ - 1, 1 ] ) add( new THREE.BoxGeometry( 0.08, 0.005, DEPTH - 1 ), lineMat, sign * 1.45, 0.043, - 0.3, { cast: false } );

		add( new THREE.BoxGeometry( WIDTH + WALL * 2, HEIGHT, WALL ), wallMat, 0, HEIGHT / 2, - hd - WALL / 2 );
		for ( const sign of [ - 1, 1 ] ) {

			add( new THREE.BoxGeometry( WALL, HEIGHT, DEPTH + WALL ), wallMat, sign * ( hw + WALL / 2 ), HEIGHT / 2, WALL / 2 );
			const sideW = hw - DOOR_W / 2;
			add( new THREE.BoxGeometry( sideW, HEIGHT, WALL ), wallMat, sign * ( DOOR_W / 2 + sideW / 2 ), HEIGHT / 2, hd + WALL / 2 );

		}

		add( new THREE.BoxGeometry( DOOR_W, HEIGHT - DOOR_H, WALL ), wallMat, 0, DOOR_H + ( HEIGHT - DOOR_H ) / 2, hd + WALL / 2 );
		add( new THREE.BoxGeometry( WIDTH + WALL * 2 + 0.4, 0.2, DEPTH + WALL * 2 + 0.6 ), trimMat, 0, HEIGHT + 0.1, 0.1 );

		for ( const sign of [ - 1, 1 ] ) add( new THREE.BoxGeometry( 0.12, DOOR_H, 0.08 ), trimMat, sign * ( DOOR_W / 2 + 0.06 ), DOOR_H / 2, hd + WALL + 0.04 );
		add( new THREE.BoxGeometry( DOOR_W + 0.24, 0.12, 0.08 ), trimMat, 0, DOOR_H + 0.06, hd + WALL + 0.04 );

		const sign = add( new THREE.PlaneGeometry( 2.2, 0.42 ), new THREE.MeshStandardMaterial( { map: makeSignTexture(), emissive: 0xffffff, emissiveMap: makeSignTexture(), emissiveIntensity: 0.6 } ), 0, DOOR_H + 0.33, hd + WALL + 0.01, { cast: false } );
		sign.receiveShadow = false;

		const doorTex = makeDoorTexture();
		this.doorTexture = doorTex;
		this.door = add( new THREE.PlaneGeometry( DOOR_W, DOOR_H ), new THREE.MeshStandardMaterial( { map: doorTex, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide } ), 0, DOOR_H / 2, hd + WALL * 0.5 );

		this.lampMaterial = new THREE.MeshStandardMaterial( { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 } );
		this.lights = [];
		for ( const z of [ - 2, 1.4 ] ) {

			for ( const x of [ - 1.3, 1.3 ] ) add( new THREE.BoxGeometry( 0.12, 0.04, 1.6 ), this.lampMaterial, x, HEIGHT - 0.03, z, { cast: false } );
			const light = new THREE.PointLight( 0xfff1de, 0, 9, 1.5 );
			light.visible = false;
			light.position.set( 0, HEIGHT - 0.4, z );
			g.add( light );
			this.lights.push( light );

		}

		const red = new THREE.MeshStandardMaterial( { color: 0xb3121b, roughness: 0.35, metalness: 0.5 } );
		const cabinet = add( new THREE.BoxGeometry( 1.6, 1.0, 0.55 ), red, - 1.6, 0.52, - hd + 0.3 );
		for ( let i = 0; i < 4; i ++ ) add( new THREE.BoxGeometry( 1.5, 0.02, 0.01 ), trimMat, - 1.6, 0.25 + i * 0.22, - hd + 0.58, { cast: false } );
		cabinet.name = 'cabinet';

		add( new THREE.BoxGeometry( 1.5, 0.05, 0.6 ), trimMat, 1.8, 1.6, - hd + 0.32 );
		add( new THREE.BoxGeometry( 1.5, 0.05, 0.6 ), trimMat, 1.8, 0.7, - hd + 0.32 );
		const tireMat = new THREE.MeshStandardMaterial( { color: 0x111111, roughness: 0.9 } );
		const tireGeo = new THREE.TorusGeometry( 0.26, 0.11, 12, 24 );
		for ( let i = 0; i < 4; i ++ ) {

			const tire = add( tireGeo, tireMat, 1.25 + i * 0.37, 0.98 + ( i % 2 ) * 0.92, - hd + 0.32 );
			tire.rotation.y = Math.PI / 2;

		}

		const ext = add( new THREE.CylinderGeometry( 0.08, 0.08, 0.5, 16 ), red, hw - 0.2, 0.3, 1.5 );
		ext.name = 'extinguisher';

		this.buildBeacon( trimMat );

		this.updateDoor();

	}

	updateDoor() {

		const h = Math.max( 1 - this.doorOpen, 0.001 );
		this.door.scale.y = h;
		this.door.position.y = DOOR_H - ( DOOR_H * h ) / 2;
		this.door.visible = this.doorOpen < 0.999;
		this.doorTexture.repeat.y = h;

	}

	// Giroflex laranja em cima do portão: gira e pisca enquanto o portão se move (sem luz de verdade,
	// só material emissivo, para não pesar). Feito de uma cúpula com um "refletor" girando dentro.
	buildBeacon( baseMaterial ) {

		const beacon = new THREE.Group();
		beacon.position.set( DOOR_W / 2 - 0.2, HEIGHT + 0.2, DEPTH / 2 + WALL - 0.15 );
		this.object.add( beacon );

		const base = new THREE.Mesh( new THREE.CylinderGeometry( 0.14, 0.16, 0.08, 16 ), baseMaterial );
		base.position.y = 0.04;
		this.beaconLamp = new THREE.MeshStandardMaterial( { color: 0xff8a00, emissive: 0xff7a00, emissiveIntensity: 0, transparent: true, opacity: 0.85, roughness: 0.2 } );
		const dome = new THREE.Mesh( new THREE.SphereGeometry( 0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2 ), this.beaconLamp );
		dome.position.y = 0.08;
		dome.scale.y = 1.6;

		this.beaconSpinner = new THREE.Group();
		this.beaconSpinner.position.y = 0.16;
		this.beaconFlash = new THREE.MeshBasicMaterial( { color: 0xffc070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } );
		const reflector = new THREE.Mesh( new THREE.PlaneGeometry( 0.09, 0.14 ), this.beaconFlash );
		reflector.position.x = 0.05;
		const beam = new THREE.Mesh( new THREE.PlaneGeometry( 1.4, 0.18 ), this.beaconFlash );
		beam.position.x = 0.75;
		this.beaconSpinner.add( reflector, beam );

		beacon.add( base, dome, this.beaconSpinner );
		this.beaconOn = 0;
		this.beaconTime = 0;

	}

	// Chamado a cada quadro: liga o giroflex quando o portão está em movimento e desliga aos poucos.
	animate( dt ) {

		const moving = Math.abs( this.doorOpen - ( this._lastDoor ?? this.doorOpen ) ) > 1e-4;
		this._lastDoor = this.doorOpen;
		this.beaconTime = moving ? 1.2 : Math.max( 0, this.beaconTime - dt );
		this.beaconOn += ( ( this.beaconTime > 0 ? 1 : 0 ) - this.beaconOn ) * Math.min( 1, dt * 6 );

		this.beaconSpinner.rotation.y += dt * 9 * this.beaconOn;
		const pulse = 0.6 + 0.4 * Math.sin( performance.now() * 0.02 );
		this.beaconLamp.emissiveIntensity = 2.2 * this.beaconOn * pulse;
		this.beaconFlash.opacity = 0.9 * this.beaconOn;
		this.beaconSpinner.visible = this.beaconOn > 0.01;

	}

	setDoor( open ) {

		this.doorTarget = open;

		return animate( {
			key: 'garage-door', from: this.doorOpen, to: open ? 1 : 0,
			duration: 2.2 * Math.abs( ( open ? 1 : 0 ) - this.doorOpen ),
			onUpdate: ( v ) => {

				this.doorOpen = v;
				this.updateDoor();

			},
		} );

	}

	setLight( on ) {

		this.lightOn = on;
		return animate( {
			key: 'garage-light', from: on ? 0 : 1, to: on ? 1 : 0, duration: 0.5, easing: ease.out,
			onUpdate: ( v ) => {

				const flicker = on && v < 0.6 ? ( Math.random() > 0.5 ? 1 : 0.2 ) : 1;
				for ( const l of this.lights ) {

					l.intensity = v * 25 * flicker;
					l.visible = v > 0;

				}
				this.lampMaterial.emissiveIntensity = v * 4 * flicker;

			},
		} );

	}

	update( car ) {

		if ( ! this.doorTarget && this.doorOpen > 0 && car.collides( [ this.doorway ] ) ) {

			this.setDoor( true );
			return true;

		}

		return false;

	}

	isNear( point, margin = 0 ) {

		const p = this.object.position;
		return Math.abs( point.x - p.x ) < WIDTH / 2 + WALL + margin && Math.abs( point.z - p.z ) < DEPTH / 2 + WALL + margin;

	}

	contains( point ) {

		const p = this.object.position;
		return Math.abs( point.x - p.x ) < WIDTH / 2 && Math.abs( point.z - p.z ) < DEPTH / 2;

	}

}

function makeDoorTexture() {

	const c = document.createElement( 'canvas' );
	c.width = 256;
	c.height = 512;
	const ctx = c.getContext( '2d' );
	ctx.fillStyle = '#c9ccd1';
	ctx.fillRect( 0, 0, 256, 512 );

	for ( let y = 0; y < 512; y += 32 ) {

		const grad = ctx.createLinearGradient( 0, y, 0, y + 32 );
		grad.addColorStop( 0, '#e3e5e8' );
		grad.addColorStop( 0.8, '#b4b8be' );
		grad.addColorStop( 1, '#7d8187' );
		ctx.fillStyle = grad;
		ctx.fillRect( 0, y, 256, 32 );

	}

	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapT = THREE.RepeatWrapping;
	return tex;

}

function makeSignTexture() {

	const c = document.createElement( 'canvas' );
	c.width = 512;
	c.height = 100;
	const ctx = c.getContext( '2d' );
	ctx.fillStyle = '#16181c';
	ctx.fillRect( 0, 0, 512, 100 );
	ctx.fillStyle = '#ffd400';
	ctx.font = 'bold 58px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( 'GARAGEM', 256, 54 );
	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;

}
