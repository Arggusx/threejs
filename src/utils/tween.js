const active = new Map();
let nextId = 0;

export const ease = {
	linear: ( k ) => k,
	inOut: ( k ) => ( k < 0.5 ? 4 * k * k * k : 1 - Math.pow( - 2 * k + 2, 3 ) / 2 ),
	out: ( k ) => 1 - Math.pow( 1 - k, 3 ),
	outBack: ( k ) => 1 + 2.2 * Math.pow( k - 1, 3 ) + 1.2 * Math.pow( k - 1, 2 ),
};

export function animate( { key = `tween-${ nextId ++ }`, from = 0, to = 1, duration = 1, easing = ease.inOut, onUpdate } ) {

	const previous = active.get( key );
	if ( previous ) previous.resolve( false );

	return new Promise( ( resolve ) => {

		if ( duration <= 0 ) {

			onUpdate( to );
			resolve( true );
			return;

		}

		active.set( key, { t: 0, from, to, duration, easing, onUpdate, resolve } );

	} );

}

export function updateTweens( dt ) {

	for ( const [ key, tw ] of active ) {

		tw.t += dt;
		const k = Math.min( tw.t / tw.duration, 1 );
		tw.onUpdate( tw.from + ( tw.to - tw.from ) * tw.easing( k ) );

		if ( k >= 1 ) {

			active.delete( key );
			tw.resolve( true );

		}

	}

}

export const wait = ( seconds ) => animate( { duration: seconds, onUpdate: () => {} } );
