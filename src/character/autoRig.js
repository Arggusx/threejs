import * as THREE from 'three';

// Gera um esqueleto simples para um modelo estático (sem rig) e transforma as malhas dele em
// SkinnedMesh. Os ossos usam os nomes do Mixamo (mixamorigHips, mixamorigLeftArm...), então
// `Character.js` anima o resultado igual a um personagem com rig de verdade.
//
// `joints`: posição de cada osso no espaço do modelo, `parents`: pai de cada osso,
// `weigh( v )`: para um vértice (espaço do modelo), devolve [[osso, peso], ...].
export function autoRig( source, { joints, parents, weigh } ) {

	source.updateMatrixWorld( true );

	const bones = {};
	for ( const name of Object.keys( joints ) ) {

		const bone = new THREE.Bone();
		bone.name = `mixamorig${ name }`;
		bones[ name ] = bone;

	}

	let root = null;
	for ( const [ name, bone ] of Object.entries( bones ) ) {

		const parent = parents[ name ];
		const at = new THREE.Vector3( ...joints[ name ] );
		if ( parent ) {

			bone.position.copy( at ).sub( new THREE.Vector3( ...joints[ parent ] ) );
			bones[ parent ].add( bone );

		} else {

			bone.position.copy( at );
			root = bone;

		}

	}

	const group = new THREE.Group();
	group.add( root );
	group.updateMatrixWorld( true );

	const list = Object.values( bones );
	const index = new Map( list.map( ( b, i ) => [ b.name.replace( 'mixamorig', '' ), i ] ) );
	const skeleton = new THREE.Skeleton( list );

	const v = new THREE.Vector3();
	source.traverse( ( o ) => {

		if ( ! o.isMesh ) return;

		const geometry = o.geometry.clone().applyMatrix4( o.matrixWorld );
		const position = geometry.attributes.position;
		const skinIndex = new Uint16Array( position.count * 4 );
		const skinWeight = new Float32Array( position.count * 4 );

		for ( let i = 0; i < position.count; i ++ ) {

			v.fromBufferAttribute( position, i );
			const weights = weigh( v ).slice( 0, 4 );
			const total = weights.reduce( ( a, [ , w ] ) => a + w, 0 ) || 1;
			weights.forEach( ( [ name, w ], k ) => {

				skinIndex[ i * 4 + k ] = index.get( name );
				skinWeight[ i * 4 + k ] = w / total;

			} );

		}

		geometry.setAttribute( 'skinIndex', new THREE.BufferAttribute( skinIndex, 4 ) );
		geometry.setAttribute( 'skinWeight', new THREE.BufferAttribute( skinWeight, 4 ) );

		const mesh = new THREE.SkinnedMesh( geometry, o.material );
		mesh.name = o.name;
		group.add( mesh );
		mesh.bind( skeleton, new THREE.Matrix4() );

	} );

	return group;

}

// Distância de um ponto ao segmento a–b.
export function segmentDistance( p, a, b ) {

	const ab = new THREE.Vector3().subVectors( b, a );
	const t = THREE.MathUtils.clamp( new THREE.Vector3().subVectors( p, a ).dot( ab ) / ab.lengthSq(), 0, 1 );
	return p.distanceTo( a.clone().addScaledVector( ab, t ) );

}
