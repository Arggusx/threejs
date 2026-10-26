import * as THREE from 'three';
import { animate, ease } from '../utils/tween.js';

const WIDTH = 6; // interno
const DEPTH = 7.6;
const HEIGHT = 3.2;
const WALL = 0.25;
const DOOR_W = 3.8;
const DOOR_H = 2.6;

// Garagem com portão basculante, alinhada aos eixos, com a entrada voltada para +Z
export class Garage {

	constructor( position = new THREE.Vector3( 14, 0, - 22 ) ) {

		this.object = new THREE.Group();
		this.object.name = 'garage';
		this.object.position.copy( position );

		this.doorOpen = 0;
		this.doorTarget = false;
		this.lightOn = false;

		this.build();

		const p = position;
		// Pontos usados pelo piloto automático
		this.parkSpot = new THREE.Vector3( p.x, 0, p.z - 0.25 );
		this.entrance = new THREE.Vector3( p.x, 0, p.z + DEPTH / 2 + WALL );

		// Colisores (retângulos no plano XZ, em coordenadas de mundo)
		const box = ( x0, z0, x1, z1 ) => new THREE.Box2( new THREE.Vector2( p.x + x0, p.z + z0 ), new THREE.Vector2( p.x + x1, p.z + z1 ) );
		const hw = WIDTH / 2, hd = DEPTH / 2;
		this.walls = [
			box( - hw - WALL, - hd - WALL, hw + WALL, - hd ), // fundo
			box( - hw - WALL, - hd, - hw, hd + WALL ), // esquerda
			box( hw, - hd, hw + WALL, hd + WALL ), // direita
			box( - hw, hd, - DOOR_W / 2, hd + WALL ), // frente (lado esquerdo do portão)
			box( DOOR_W / 2, hd, hw, hd + WALL ), // frente (lado direito)
		];
		this.doorCollider = box( - DOOR_W / 2, hd, DOOR_W / 2, hd + WALL );
		// Faixa sob o portão vigiada pelo "sensor de obstrução"
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

		// Piso (epóxi brilhante) com faixa de vaga
		add( new THREE.BoxGeometry( WIDTH, 0.04, DEPTH ), floorMat, 0, 0.02, 0, { cast: false } );
		const lineMat = new THREE.MeshStandardMaterial( { color: 0xf2c200, roughness: 0.5 } );
		for ( const sign of [ - 1, 1 ] ) add( new THREE.BoxGeometry( 0.08, 0.005, DEPTH - 1 ), lineMat, sign * 1.45, 0.043, - 0.3, { cast: false } );

		// Paredes
		add( new THREE.BoxGeometry( WIDTH + WALL * 2, HEIGHT, WALL ), wallMat, 0, HEIGHT / 2, - hd - WALL / 2 );
		for ( const sign of [ - 1, 1 ] ) {

			add( new THREE.BoxGeometry( WALL, HEIGHT, DEPTH + WALL ), wallMat, sign * ( hw + WALL / 2 ), HEIGHT / 2, WALL / 2 );
			const sideW = hw - DOOR_W / 2;
			add( new THREE.BoxGeometry( sideW, HEIGHT, WALL ), wallMat, sign * ( DOOR_W / 2 + sideW / 2 ), HEIGHT / 2, hd + WALL / 2 );

		}

		// Viga sobre o portão e telhado
		add( new THREE.BoxGeometry( DOOR_W, HEIGHT - DOOR_H, WALL ), wallMat, 0, DOOR_H + ( HEIGHT - DOOR_H ) / 2, hd + WALL / 2 );
		add( new THREE.BoxGeometry( WIDTH + WALL * 2 + 0.4, 0.2, DEPTH + WALL * 2 + 0.6 ), trimMat, 0, HEIGHT + 0.1, 0.1 );

		// Batentes do portão
		for ( const sign of [ - 1, 1 ] ) add( new THREE.BoxGeometry( 0.12, DOOR_H, 0.08 ), trimMat, sign * ( DOOR_W / 2 + 0.06 ), DOOR_H / 2, hd + WALL + 0.04 );
		add( new THREE.BoxGeometry( DOOR_W + 0.24, 0.12, 0.08 ), trimMat, 0, DOOR_H + 0.06, hd + WALL + 0.04 );

		// Placa
		const sign = add( new THREE.PlaneGeometry( 2.2, 0.42 ), new THREE.MeshStandardMaterial( { map: makeSignTexture(), emissive: 0xffffff, emissiveMap: makeSignTexture(), emissiveIntensity: 0.6 } ), 0, DOOR_H + 0.33, hd + WALL + 0.01, { cast: false } );
		sign.receiveShadow = false;

		// Portão basculante: um painel ancorado no topo que "recolhe" para cima
		const doorTex = makeDoorTexture();
		this.doorTexture = doorTex;
		this.door = add( new THREE.PlaneGeometry( DOOR_W, DOOR_H ), new THREE.MeshStandardMaterial( { map: doorTex, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide } ), 0, DOOR_H / 2, hd + WALL * 0.5 );

		// Iluminação interna: barras de LED no teto + luzes pontuais
		this.lampMaterial = new THREE.MeshStandardMaterial( { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 } );
		this.lights = [];
		for ( const z of [ - 2, 1.4 ] ) {

			for ( const x of [ - 1.3, 1.3 ] ) add( new THREE.BoxGeometry( 0.12, 0.04, 1.6 ), this.lampMaterial, x, HEIGHT - 0.03, z, { cast: false } );
			const light = new THREE.PointLight( 0xfff1de, 0, 9, 1.5 );
			light.position.set( 0, HEIGHT - 0.4, z );
			g.add( light );
			this.lights.push( light );

		}

		// Detalhes: armário de ferramentas, prateleira com pneus e um extintor
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

		this.updateDoor();

	}

	updateDoor() {

		const h = Math.max( 1 - this.doorOpen, 0.001 );
		this.door.scale.y = h;
		this.door.position.y = DOOR_H - ( DOOR_H * h ) / 2;
		this.door.visible = this.doorOpen < 0.999;
		this.doorTexture.repeat.y = h;

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

				// pequena "piscada" de lâmpada fluorescente ao ligar
				const flicker = on && v < 0.6 ? ( Math.random() > 0.5 ? 1 : 0.2 ) : 1;
				for ( const l of this.lights ) l.intensity = v * 25 * flicker;
				this.lampMaterial.emissiveIntensity = v * 4 * flicker;

			},
		} );

	}

	// Sensor de obstrução: se o portão está fechando com algo embaixo, ele volta a abrir
	update( car ) {

		if ( ! this.doorTarget && this.doorOpen > 0 && car.collides( [ this.doorway ] ) ) {

			this.setDoor( true );
			return true;

		}

		return false;

	}

	// Verdadeiro se o ponto estiver dentro da garagem ou a menos de `margin` metros dela
	isNear( point, margin = 0 ) {

		const p = this.object.position;
		return Math.abs( point.x - p.x ) < WIDTH / 2 + WALL + margin && Math.abs( point.z - p.z ) < DEPTH / 2 + WALL + margin;

	}

	// Verdadeiro se o centro do carro estiver dentro da garagem
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
