import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = [ 'position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'tangent', 'color' ];
const KEEP_SKINNED = [ 'position', 'normal', 'uv' ];

// Junta as malhas estáticas que andam juntas (mesmo "quadro" móvel) e usam o mesmo material numa
// malha só. `frames` são os objetos que se mexem em tempo de execução (chassi, rodas, portas...):
// cada malha vai para o quadro móvel mais próximo acima dela, então nada perde o movimento.
export function mergeStaticMeshes( root, frames = [] ) {

	const moving = new Set( [ root, ...frames ] );
	root.updateMatrixWorld( true );

	const groups = new Map();

	root.traverse( ( o ) => {

		if ( ! o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.children.length ) return;
		if ( ! o.material || Array.isArray( o.material ) || o.material.visible === false ) return;
		if ( ! isVisible( o, root ) || moving.has( o ) ) return;

		let frame = o.parent;
		while ( ! moving.has( frame ) ) frame = frame.parent;

		const g = o.geometry;
		const signature = KEEP.filter( ( n ) => g.attributes[ n ] ).join() + ( g.index ? ':i' : '' );
		const key = `${ frame.id }|${ o.material.uuid }|${ o.castShadow }|${ o.receiveShadow }|${ o.renderOrder }|${ signature }`;
		if ( ! groups.has( key ) ) groups.set( key, { frame, meshes: [] } );
		groups.get( key ).meshes.push( o );

	} );

	let removed = 0;
	const inverse = new THREE.Matrix4();
	const relative = new THREE.Matrix4();

	for ( const { frame, meshes } of groups.values() ) {

		if ( meshes.length < 2 ) continue;

		inverse.copy( frame.matrixWorld ).invert();
		const geometries = meshes.map( ( m ) => {

			const g = strip( m.geometry );
			relative.multiplyMatrices( inverse, m.matrixWorld );
			g.applyMatrix4( relative );
			return g;

		} );

		const merged = mergeGeometries( geometries );
		for ( const g of geometries ) g.dispose();
		if ( ! merged ) continue;

		const first = meshes[ 0 ];
		const mesh = new THREE.Mesh( merged, first.material );
		mesh.name = `${ first.material.name || 'merged' }_merged`;
		mesh.castShadow = first.castShadow;
		mesh.receiveShadow = first.receiveShadow;
		mesh.renderOrder = first.renderOrder;
		frame.add( mesh );

		for ( const m of meshes ) {

			m.removeFromParent();
			m.geometry.dispose();

		}

		removed += meshes.length - 1;

	}

	return removed;

}

// Para modelos com peças rígidas animadas por nós (como o Optimus, em que quase cada peça tem o
// seu próprio nó animado), transforma tudo em poucas SkinnedMesh — uma por material — que
// compartilham um único esqueleto. Cada peça rígida vira um "osso" (o nó pai dela), então a
// animação original continua funcionando, mas com ~1 chamada de desenho por material.
export function bakeToSkinnedMeshes( root ) {

	root.updateMatrixWorld( true );

	const sourceSkeleton = findSkeleton( root );
	const bones = sourceSkeleton ? [ ...sourceSkeleton.bones ] : [];
	const boneInverses = sourceSkeleton ? sourceSkeleton.boneInverses.map( ( m ) => m.clone() ) : [];
	const boneIndex = new Map( bones.map( ( b, i ) => [ b, i ] ) );
	const bindMatrix = root.matrixWorld.clone();
	const bindInverse = bindMatrix.clone().invert();

	const indexOf = ( object ) => {

		if ( ! boneIndex.has( object ) ) {

			boneIndex.set( object, bones.length );
			bones.push( object );
			boneInverses.push( object.matrixWorld.clone().invert().multiply( bindMatrix ) );

		}

		return boneIndex.get( object );

	};

	const groups = new Map();
	const sources = [];

	root.traverse( ( o ) => {

		if ( ! o.isMesh || ! o.material || Array.isArray( o.material ) || ! isVisible( o, root ) ) return;
		sources.push( o );
		if ( ! groups.has( o.material ) ) groups.set( o.material, [] );
		groups.get( o.material ).push( o );

	} );

	const relative = new THREE.Matrix4();
	const meshes = [];

	for ( const [ material, list ] of groups ) {

		const geometries = list.map( ( o ) => {

			const g = strip( o.geometry, KEEP_SKINNED );
			const count = g.attributes.position.count;
			const index = new Uint16Array( count * 4 );
			const weight = new Float32Array( count * 4 );

			if ( o.isSkinnedMesh ) {

				// Mesmo esqueleto: os índices continuam válidos; só leva a geometria para o espaço de bind comum.
				const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
				for ( let i = 0; i < count; i ++ ) for ( let k = 0; k < 4; k ++ ) {

					index[ i * 4 + k ] = indexOf( o.skeleton.bones[ si.getComponent( i, k ) ] );
					weight[ i * 4 + k ] = sw.getComponent( i, k );

				}

				relative.multiplyMatrices( bindInverse, o.bindMatrix );

			} else {

				const bone = indexOf( o.parent );
				for ( let i = 0; i < count; i ++ ) {

					index[ i * 4 ] = bone;
					weight[ i * 4 ] = 1;

				}

				relative.multiplyMatrices( bindInverse, o.matrixWorld );

			}

			g.applyMatrix4( relative );
			g.setAttribute( 'skinIndex', new THREE.BufferAttribute( index, 4 ) );
			g.setAttribute( 'skinWeight', new THREE.BufferAttribute( weight, 4 ) );
			return g;

		} );

		const indexed = geometries.every( ( g ) => g.index );
		const merged = mergeGeometries( indexed ? geometries : geometries.map( ( g ) => ( g.index ? g.toNonIndexed() : g ) ) );
		for ( const g of geometries ) g.dispose();

		const mesh = new THREE.SkinnedMesh( merged, material );
		mesh.name = `${ material.name || 'part' }_skinned`;
		mesh.frustumCulled = false;
		meshes.push( mesh );

	}

	const skeleton = new THREE.Skeleton( bones, boneInverses );
	for ( const mesh of meshes ) {

		root.add( mesh );
		mesh.bind( skeleton, bindMatrix );

	}

	for ( const o of sources ) {

		o.visible = false;
		o.geometry.dispose();

	}

	return meshes;

}

function strip( geometry, keep = KEEP ) {

	const g = new THREE.BufferGeometry();
	for ( const name of keep ) {

		const a = geometry.attributes[ name ];
		if ( a ) g.setAttribute( name, toFloat( a ) );
		else if ( keep === KEEP_SKINNED ) {

			// Todas as peças de um mesmo material precisam ter os mesmos atributos para serem juntadas.
			const size = name === 'uv' ? 2 : 3;
			g.setAttribute( name, new THREE.BufferAttribute( new Float32Array( geometry.attributes.position.count * size ), size ) );

		}

	}
	if ( geometry.index ) g.setIndex( geometry.index.clone() );
	return g;

}

function toFloat( attribute ) {

	const { count, itemSize } = attribute;
	const array = new Float32Array( count * itemSize );
	for ( let i = 0; i < count; i ++ ) for ( let k = 0; k < itemSize; k ++ ) array[ i * itemSize + k ] = attribute.getComponent( i, k );
	return new THREE.BufferAttribute( array, itemSize );

}

function findSkeleton( root ) {

	let skeleton = null;
	root.traverse( ( o ) => ! skeleton && o.isSkinnedMesh && ( skeleton = o.skeleton ) );
	return skeleton;

}

function isVisible( object, root ) {

	for ( let o = object; o && o !== root; o = o.parent ) if ( ! o.visible ) return false;
	return true;

}
