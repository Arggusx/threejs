import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Terrain } from './terrain.js';
import { createRamp } from './ramp.js';
import { mergeStaticMeshes } from '../utils/merge.js';

// O modelo vem em escala de pista de kart (~0,2 de largura de pista); 50x deixa a pista com ~11 m.
const SCALE = 50;
const SKY = /^sky_/;
const GROUND = /^tgsd_12_01/;
const MINIMAP = /^mini_map/;
const MOUNTAINS = /^tgsd_02_03/;
const ROAD = /^(road_|raod_)/;
const PLAZA = 'road_tgsd_12_02_tgsd_11_0';
// Parte da luz vira "emissiva" para manter as cores do mapa (que era sem iluminação) e ainda receber sombras.
const SELF_LIGHT = 0.6;

const loader = new GLTFLoader().setDRACOLoader( new DRACOLoader().setDecoderPath( './draco/' ) );

// Cenário de doces: ilhas com a pista no alto, gramado em volta e montanhas no horizonte.
// O gramado fica na altura 0. A pista (incluindo a praça quadriculada de largada) é chão; ilhas e doces
// são obstáculos. Uma rampa liga a praça ao gramado.
export class SugarRush {

	constructor() {

		this.object = new THREE.Group();
		this.object.name = 'sugar-rush';

	}

	async load( onProgress ) {

		const gltf = await loader.loadAsync( './models/map/sugar_rush.glb', ( e ) => e.total && onProgress?.( e.loaded / e.total ) );
		const map = gltf.scene;
		map.scale.setScalar( SCALE );
		this.object.add( map );

		map.updateMatrixWorld( true );
		const ground = map.getObjectByName( 'tgsd_12_01_road_tgsd_12_0' );
		map.position.y = - new THREE.Box3().setFromObject( ground ).max.y;
		map.updateMatrixWorld( true );

		const floors = [];
		const solids = [];
		const materials = new Map();

		map.traverse( ( o ) => {

			if ( ! o.isMesh ) return;

			if ( MINIMAP.test( o.name ) ) {

				o.visible = false;
				return;

			}

			if ( SKY.test( o.name ) ) {

				o.material.fog = false;
				o.material.depthWrite = false;
				o.renderOrder = - 1;
				o.frustumCulled = false;
				this.sky = o;
				return;

			}

			if ( ! materials.has( o.material ) ) materials.set( o.material, litMaterial( o.material ) );
			o.material = materials.get( o.material );
			o.receiveShadow = true;
			if ( ROAD.test( o.name ) ) floors.push( o );
			else if ( ! GROUND.test( o.name ) && ! MOUNTAINS.test( o.name ) ) solids.push( o );

		} );

		// Praça de largada: plana, ~49 x 49 m, a uns 30 m do gramado.
		this.plaza = new THREE.Box3().setFromObject( map.getObjectByName( PLAZA ) );
		const plazaY = this.plaza.max.y;

		// A borda sul da praça é irregular (o quadriculado acaba em z ~80 no meio); a rampa começa um
		// pouco para dentro, onde ainda é praça, e desce 160 m para o sul até o gramado.
		const rampTop = new THREE.Vector3( 47, plazaY, 77 );
		const RAMP = { length: 160, width: 14 };
		const ramp = createRamp( { top: rampTop, direction: new THREE.Vector3( 0, 0, 1 ), ...RAMP } );
		this.object.add( ramp.object );
		this.object.updateMatrixWorld( true );
		this.rampEnd = rampTop.clone().setY( 0 ).add( new THREE.Vector3( 0, 0, RAMP.length ) );

		this.terrain = new Terrain( { cell: 1, base: 0 } ).build( {
			floors: [ ...floors, ...ramp.floors ],
			solids: [ ...solids, ...ramp.solids ],
		} );

		// Enfeites do mapa (folhas, doces) que ficam em cima do caminho da rampa não bloqueiam.
		const lane = RAMP.width / 2 - 0.8;
		this.terrain.clearSolids(
			( x, z ) => Math.abs( x - rampTop.x ) < lane && z > rampTop.z - 1 && z < rampTop.z + RAMP.length,
			( x, z ) => plazaY * ( 1 - THREE.MathUtils.clamp( ( z - rampTop.z ) / RAMP.length, 0, 1 ) ),
			4
		);

		mergeStaticMeshes( map );

		return this;

	}

}

function litMaterial( basic ) {

	const material = new THREE.MeshLambertMaterial( {
		name: basic.name,
		map: basic.map,
		color: basic.color,
		vertexColors: basic.vertexColors,
		transparent: basic.transparent,
		opacity: basic.opacity,
		alphaTest: basic.alphaTest,
		side: basic.side,
		// As cores do mapa já vêm "prontas" (era um material sem luz); o tone mapping as deixava lavadas.
		toneMapped: false,
	} );

	material.onBeforeCompile = ( shader ) => {

		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <emissivemap_fragment>',
			`totalEmissiveRadiance = diffuseColor.rgb * ${ SELF_LIGHT.toFixed( 2 ) };`
		);

	};

	basic.dispose();
	return material;

}
