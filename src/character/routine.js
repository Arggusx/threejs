// Interpolação de coreografias: uma linha do tempo de poses-chave ([tempo, pose]) vira uma função
// pose( t ) com transições suaves. Todas as poses de uma linha do tempo têm as mesmas chaves.

const smooth = ( x ) => x * x * ( 3 - 2 * x );

function mix( a, b, k ) {

	if ( typeof a === 'number' ) return a + ( b - a ) * k;
	if ( Array.isArray( a ) ) return a.map( ( v, i ) => mix( v, b[ i ], k ) );
	const out = {};
	for ( const key of Object.keys( a ) ) out[ key ] = mix( a[ key ], b[ key ], k );
	return out;

}

export function poseFromTimeline( timeline ) {

	return ( t ) => {

		if ( t <= timeline[ 0 ][ 0 ] ) return timeline[ 0 ][ 1 ];

		for ( let i = 1; i < timeline.length; i ++ ) {

			const [ t1, p1 ] = timeline[ i ];
			if ( t <= t1 ) {

				const [ t0, p0 ] = timeline[ i - 1 ];
				return mix( p0, p1, smooth( ( t - t0 ) / Math.max( t1 - t0, 1e-3 ) ) );

			}

		}

		return timeline[ timeline.length - 1 ][ 1 ];

	};

}
