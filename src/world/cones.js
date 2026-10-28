import * as THREE from 'three';

const HIT_SPEED = 1; // m/s mínimos para derrubar
const RESET_AFTER = 6; // segundos caído antes de voltar ao lugar
const WOBBLE_RANGE = 1.6; // passar a essa distância (além do raio) faz o cone balançar
const UP = new THREE.Vector3( 0, 1, 0 );

// Cones de trânsito desenhados como InstancedMesh (3 peças: cone, faixa e base). Cada um tem três
// animações: balança quando algo passa perto, cai (rolando para longe) quando é atingido e, depois
// de alguns segundos, desliza de volta e fica de pé no lugar original.
export class Cones {

	constructor( spots ) {

		this.object = new THREE.Group();
		this.object.name = 'cones';

		const orange = new THREE.MeshStandardMaterial( { color: 0xff5a00, roughness: 0.6 } );
		const white = new THREE.MeshStandardMaterial( { color: 0xffffff, roughness: 0.6 } );
		this.parts = [
			[ new THREE.ConeGeometry( 0.17, 0.55, 16 ), orange, 0.3 ],
			[ new THREE.CylinderGeometry( 0.088, 0.115, 0.1, 16 ), white, 0.33 ],
			[ new THREE.BoxGeometry( 0.4, 0.04, 0.4 ), orange, 0.02 ],
		].map( ( [ geometry, material, y ] ) => {

			const mesh = new THREE.InstancedMesh( geometry, material, spots.length );
			mesh.castShadow = mesh.receiveShadow = true;
			// Os cones se espalham quando caem; o volume pré-calculado ficaria errado.
			mesh.frustumCulled = false;
			mesh.userData.y = y;
			this.object.add( mesh );
			return mesh;

		} );

		this.cones = spots.map( ( [ x, z ] ) => ( {
			home: new THREE.Vector3( x, 0, z ),
			position: new THREE.Vector3( x, 0, z ),
			axis: new THREE.Vector3( 1, 0, 0 ),
			tilt: 0, // inclinação atual (rad)
			spin: 0,
			velocity: new THREE.Vector3(),
			state: 'idle', // idle | wobble | fallen | reset
			time: 0,
			wobble: 0,
		} ) );

		this.matrix = new THREE.Matrix4();
		this.q = new THREE.Quaternion();
		this.tmp = new THREE.Vector3();
		this.cones.forEach( ( _, i ) => this.write( i ) );

	}

	// `movers`: [{ position, radius, speed, forward }] — carros, personagens, Optimus.
	update( dt, movers ) {

		let any = false;
		for ( let i = 0; i < this.cones.length; i ++ ) {

			const c = this.cones[ i ];
			let changed = false;

			if ( c.state === 'idle' || c.state === 'wobble' ) {

				for ( const m of movers ) {

					const dx = c.position.x - m.position.x, dz = c.position.z - m.position.z;
					if ( Math.abs( m.position.y - c.position.y ) > 2 ) continue;
					const d = Math.hypot( dx, dz );
					const speed = Math.abs( m.speed );

					if ( d < m.radius + 0.2 && speed > HIT_SPEED ) {

						this.knock( c, m, dx, dz, d );
						break;

					}

					if ( d < m.radius + WOBBLE_RANGE && speed > 2 && c.state === 'idle' ) {

						c.state = 'wobble';
						c.time = 0;
						c.wobble = Math.min( 0.25, speed * 0.02 );
						c.axis.set( dz, 0, - dx ).normalize();

					}

				}

			}

			if ( c.state === 'wobble' ) {

				c.time += dt;
				c.tilt = Math.sin( c.time * 14 ) * c.wobble * Math.exp( - c.time * 3 );
				if ( c.time > 1.5 ) Object.assign( c, { state: 'idle', tilt: 0 } );
				changed = true;

			} else if ( c.state === 'fallen' ) {

				c.time += dt;
				// Tomba até deitar e rola/desliza perdendo velocidade.
				c.tilt = Math.min( Math.PI / 2 - 0.15, c.tilt + dt * 7 );
				c.position.addScaledVector( c.velocity, dt );
				c.velocity.multiplyScalar( Math.exp( - dt * 2.5 ) );
				c.spin += c.velocity.length() * dt * 4;
				if ( c.time > RESET_AFTER ) Object.assign( c, { state: 'reset', time: 0, from: c.position.clone(), fromTilt: c.tilt } );
				changed = true;

			} else if ( c.state === 'reset' ) {

				c.time += dt;
				const k = Math.min( 1, c.time / 0.8 );
				const e = k * k * ( 3 - 2 * k );
				c.position.lerpVectors( c.from, c.home, e );
				c.tilt = c.fromTilt * ( 1 - e );
				c.spin *= 1 - e;
				if ( k >= 1 ) Object.assign( c, { state: 'idle', tilt: 0, spin: 0 } );
				changed = true;

			}

			if ( changed ) {

				this.write( i );
				any = true;

			}

		}

		if ( any ) for ( const m of this.parts ) m.instanceMatrix.needsUpdate = true;

	}

	knock( c, mover, dx, dz, d ) {

		const away = d > 1e-3 ? this.tmp.set( dx / d, 0, dz / d ) : mover.forward.clone();
		// Sai na direção do empurrão, somando a direção do movimento de quem bateu.
		c.velocity.copy( away ).multiplyScalar( 0.4 ).addScaledVector( mover.forward, Math.sign( mover.speed ) ).normalize().multiplyScalar( Math.min( 12, Math.abs( mover.speed ) * 0.7 ) );
		c.axis.set( c.velocity.z, 0, - c.velocity.x ).normalize();
		c.state = 'fallen';
		c.time = 0;
		c.tilt = Math.max( c.tilt, 0.2 );

	}

	write( i ) {

		const c = this.cones[ i ];
		this.q.setFromAxisAngle( c.axis, c.tilt ).multiply( new THREE.Quaternion().setFromAxisAngle( UP, c.spin ) );
		for ( const mesh of this.parts ) {

			// Gira em torno da base (no chão) e depois sobe a peça até a altura dela.
			this.matrix.compose( c.position, this.q, new THREE.Vector3( 1, 1, 1 ) ).multiply( new THREE.Matrix4().makeTranslation( 0, mesh.userData.y, 0 ) );
			mesh.setMatrixAt( i, this.matrix );

		}

	}

}
